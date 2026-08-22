// Oracle Recruiting Cloud (ORC) REST API adapter.
//
// Two-step: (1) discover the "India" locationsFacet Id for this tenant
// (cheap facets-only call, no requisition payload), unless companies.json
// already pins one via `indiaLocationId`. (2) page through requisitions
// filtered to that facet — ORC caps each page at 200 regardless of the
// requested `limit`, so multi-page tenants (JPMorgan: 420, BNY: 147) need
// real pagination or most India jobs are silently missed.
const PAGE_SIZE = 200
const MAX_PAGES = 5 // safety cap: 1000 India reqs/company is far beyond any tenant seen so far

async function fetchJson (url) {
  const res = await fetch(url, { headers: { 'user-agent': 'devops-sre-job-hunt/1.0' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.json()
}

async function resolveIndiaLocationId (company) {
  if (company.indiaLocationId) return company.indiaLocationId
  const url = `https://${company.orcHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${company.siteNumber},facetsList=LOCATIONS`
  const d = await fetchJson(url)
  // Oracle only returns the top ~10 locationsFacet entries by TotalCount, not
  // every location with openings — for a tenant where India isn't among its
  // globally largest office locations (e.g. Dell: India buried below the
  // US/Taiwan/Singapore sites in the facet ranking), "India" never appears
  // here even though India postings exist. Null is a legitimate "not in the
  // top facets" result, not an error — fetchJobs falls back to unfiltered
  // pagination when this happens.
  const facets = d.items?.[0]?.locationsFacet ?? []
  const india = facets.find(f => f.Name === 'India')
  return india?.Id ?? null
}

export default async function fetchJobs (company) {
  if (!company.orcHost || !company.siteNumber) throw new Error('missing orcHost/siteNumber')

  const indiaId = await resolveIndiaLocationId(company)
  // No location filter when India isn't a resolvable facet — fetch all pages
  // instead and let scan.mjs's own India/Remote regex filter by PrimaryLocation,
  // same as every other adapter already does. Bounded by the same MAX_PAGES cap.
  const locationParam = indiaId ? `,selectedLocationsFacet=${indiaId}` : ''

  const out = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE
    const url = `https://${company.orcHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${company.siteNumber},facetsList=LOCATIONS,limit=${PAGE_SIZE},offset=${offset}${locationParam}`
    const d = await fetchJson(url)
    const wrapper = d.items?.[0]
    const reqs = wrapper?.requisitionList ?? []
    for (const j of reqs) {
      out.push({
        title: j.Title,
        location: j.PrimaryLocation || '',
        url: `https://${company.orcHost}/hcmUI/CandidateExperience/en/sites/${company.siteNumber}/job/${j.Id}`,
        description: j.ShortDescriptionStr ?? '',
        posted: j.PostedDate ?? null,
        postedRaw: j.PostedDate ?? null,
      })
    }
    const total = wrapper?.TotalJobsCount ?? reqs.length
    if (offset + reqs.length >= total || reqs.length === 0) break
  }
  return out
}
