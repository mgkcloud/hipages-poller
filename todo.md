# Change Detection Module for Hipages Tradiecore Leads

## Tasks

- [ ] 1. Login to tradiecore.hipages.com.au/leads
  - [ ] Use provided credentials (info@alldirectplumbing.com.au / y6729WhV)
  - [ ] Capture and analyze authentication cookies

- [ ] 2. Reverse-Engineer the Leads API
  - [ ] Intercept XHR/Fetch/GraphQL calls during page load
  - [ ] Identify JSON endpoints returning lead data
  - [ ] Create code snippet to call endpoint directly

- [ ] 3. Investigate WebSocket/SSE Real-Time Listening
  - [ ] Monitor WebSocket or Server-Sent Events traffic
  - [ ] Attach listeners for lead payload messages
  - [ ] Create example code to connect directly to WebSocket/SSE

- [ ] 4. Implement DOM Mutation Observation
  - [ ] Inject MutationObserver on leads container
  - [ ] Detect new DOM nodes (lead items)
  - [ ] Create code to send new lead data to webhook

- [ ] 5. Develop Polling Fallback Mechanism
  - [ ] Implement periodic fetch of JSON API
  - [ ] Create diff logic to detect new items
  - [ ] Add exponential back-off and auto-relogin logic

- [ ] 6. Search for Official API or Webhooks
  - [ ] Check Hipages' documentation for API endpoints
  - [ ] Look for webhook subscription options

- [ ] 7. Implement Change Detection with Webhook Integration
  - [ ] Select best method based on findings
  - [ ] Implement webhook notification to https://n8n.fy.studio/webhook/bbf85d2c-bc64-4693-a970-8a856cd8320a
  - [ ] Ensure sub-second response time
  - [ ] Add support for customizable headers and JSON body

- [ ] 8. Create Docker Container
  - [ ] Create Dockerfile
  - [ ] Document deployment instructions

- [ ] 9. Test and Validate Solution
  - [ ] Verify change detection works correctly
  - [ ] Confirm webhook notifications are sent properly
  - [ ] Test authentication persistence

- [ ] 10. Document Final Solution
  - [ ] Create comprehensive documentation
  - [ ] Include code examples and configuration options
