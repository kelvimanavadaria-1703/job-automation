function workdayRelativeToISO(postedOn){
  if (!postedOn) return null
  const now = Date.now()
  const DAY = 86_400_000
  if (/today/i.test(postedOn)) return new Date(now).toISOString()
  const m = postedOn.match(/(\d+)\+?\s*Day/i)
  if (m) return new Date(now - Number(m[1]) * DAY).toISOString()
  return new Date(now - 30 * DAY).toISOString()
}

export default async function fetchJobs(company){
  const url = `https://${company.tenant}.${company.wdHost}.myworkdayjobs.com/wday/cxs/${company.tenant}/${company.site}/jobs`
  const out = []
  const keywords = ['site reliability', 'devops', 'platform engineer', 'cloud engineer']
  const seen = new Set()
  for (const kw of keywords) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'devops-sre-job-hunt/1.0' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: kw }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const j of data.jobPostings ?? []) {
        if (seen.has(j.externalPath)) continue
        seen.add(j.externalPath)
        out.push({
          title: j.title,
          location: j.locationsText ?? '',
          url: `${company.jobViewBase}${j.externalPath}`,
          description: '',
          posted: workdayRelativeToISO(j.postedOn),
          postedRaw: j.postedOn,
        })
      }
    } catch (err) { /* ignore keyword miss */ }
  }
  return out
}
