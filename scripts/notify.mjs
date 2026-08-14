#!/usr/bin/env node
import process from 'process'

async function main () {
  const args = process.argv.slice(2)
  const text = args.includes('--text') ? args[args.indexOf('--text') + 1] : null
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) {
    console.error('SLACK_WEBHOOK_URL not set in environment')
    process.exit(2)
  }
  if (!text) {
    console.error('Usage: node scripts/notify.mjs --text "message"')
    process.exit(2)
  }
  try {
    await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) })
    console.log('Notification sent to Slack')
  } catch (err) {
    console.error('Failed to send notification:', err.message)
    process.exit(1)
  }
}

main()
