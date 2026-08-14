export default async function fetchJobs(company){
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'devops-sre-job-hunt/1.0' }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (data.jobs ?? []).map(j => ({
      title: j.title, location: j.location?.name ?? '', url: j.absolute_url,
      description: j.content ?? '', posted: j.first_published ?? j.updated_at, postedRaw: j.first_published ?? j.updated_at
    }))
  } catch (err) {
    throw err
  }
}
