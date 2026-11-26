// Ashby public job-board API — used by many newer startups (Atlan, Sarvam AI, …).
export default async function fetchJobs (company) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`
  const res = await fetch(url, { headers: { 'user-agent': 'devops-sre-job-hunt/1.0' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.jobs ?? []).filter(j => j.isListed !== false).map(j => ({
    title: j.title,
    location: [j.location, ...(j.secondaryLocations ?? []).map(s => s.location)].filter(Boolean).join('; ') + (j.isRemote ? '; Remote' : ''),
    url: j.jobUrl,
    description: j.descriptionPlain ?? '',
    posted: j.publishedAt,
    postedRaw: j.publishedAt
  }))
}
