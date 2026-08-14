export default async function fetchJobs(company){
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'devops-sre-job-hunt/1.0' }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    const arr = Array.isArray(d) ? d : []
    return arr.map(j => ({
      title: j.text, location: j.categories?.location ?? '', url: j.hostedUrl,
      description: j.descriptionPlain ?? j.description ?? '', posted: j.createdAt, postedRaw: j.createdAt
    }))
  } catch (err) {
    throw err
  }
}
