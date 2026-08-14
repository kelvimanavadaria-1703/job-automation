export default async function fetchJobs(company){
  // Generic fetch to careersUrl; often HTML; return a minimal item pointing to the careers page
  if (!company.careersUrl) throw new Error('no careersUrl for webfetch')
  try {
    const res = await fetch(company.careersUrl, { headers: { 'user-agent': 'devops-sre-job-hunt/1.0' }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // do not attempt complex scraping here; leave for specialized adapter
    return [{ title: 'careers page', location: '', url: company.careersUrl, description: '', posted: null, postedRaw: null }]
  } catch (err) { throw err }
}
