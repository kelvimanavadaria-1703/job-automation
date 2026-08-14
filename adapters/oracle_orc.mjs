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
  const facets = d.items?.[0]?.locationsFacet ?? []
  const india = facets.find(f => f.Name === 'India')
  return india?.Id ?? null
}

export default async function fetchJobs (company) {
  if (!company.orcHost || !company.siteNumber) throw new Error('missing orcHost/siteNumber')

  const indiaId = await resolveIndiaLocationId(company)
  if (!indiaId) throw new Error('could not resolve India locationsFacet Id')

  const out = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE
    const url = `https://${company.orcHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${company.siteNumber},facetsList=LOCATIONS,limit=${PAGE_SIZE},offset=${offset},selectedLocationsFacet=${indiaId}`
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
