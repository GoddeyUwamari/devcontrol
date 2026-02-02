# Weekly AI Summary Email - Testing Guide

## Quick Test Commands

### 1. Test Email Configuration
```bash
curl http://localhost:8080/api/ai-insights/test-email-config
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Email configuration is valid and ready to send",
  "smtp": {
    "host": "smtp.gmail.com",
    "port": "587",
    "user": "uwamarigoddey@gmail.com",
    "configured": true
  }
}
```

### 2. Preview Email Data (Without Sending)
```bash
curl http://localhost:8080/api/ai-insights/preview-weekly-summary
```

This shows exactly what data will be included in the email without actually sending it.

### 3. Send Test Email to All Organizations
```bash
curl -X POST http://localhost:8080/api/ai-insights/trigger-weekly-summary \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Weekly summary triggered successfully. Check your email inbox.",
  "result": {
    "sent": 8,
    "errors": 0
  }
}
```

### 4. Send Test Email to Specific Organization
```bash
curl -X POST http://localhost:8080/api/ai-insights/trigger-weekly-summary \
  -H "Content-Type: application/json" \
  -d '{"organizationId": "your-org-id-here"}'
```

---

## Email Content Verification

### What to Check in the Email

1. **Subject Line**
   - Should be: "Your DevControl Weekly Summary (AI-Powered)"

2. **Personalization**
   - Greeting should use your first name
   - Data should be specific to your organization

3. **Cost Section** (Green border)
   - Shows current vs previous week costs
   - AI-generated summary explaining the change
   - Example: "Costs increased 15.2% this week ($850 → $979)."

4. **Alerts Section** (Yellow border, only if alerts exist)
   - Total alert count
   - Critical alert count
   - AI-generated summary of most important alerts

5. **DORA Metrics** (Blue border)
   - Deployment frequency
   - Lead time
   - Change failure rate
   - AI-generated summary of performance

6. **AI Recommendation** (Purple border)
   - Actionable recommendation
   - Estimated savings if applicable
   - Example: "Save $250/month"

7. **Call-to-Action Button**
   - "View Full Dashboard" button
   - Should link to: http://localhost:3010/dashboard

8. **Footer**
   - Unsubscribe link → http://localhost:3010/settings/notifications
   - Email Preferences link
   - Copyright notice

---

## Testing Checklist

### Before Production

- [ ] Send test email to yourself
- [ ] Verify email arrives in inbox (not spam)
- [ ] Check rendering in Gmail
- [ ] Check rendering in Outlook
- [ ] Check rendering on mobile device
- [ ] Click all links to verify they work
- [ ] Verify personalization is correct
- [ ] Verify data is accurate (not placeholder)
- [ ] Test unsubscribe link works
- [ ] Check email on dark mode

### Production Readiness

- [ ] Add user opt-in/opt-out preferences
- [ ] Configure SPF record for custom domain
- [ ] Configure DKIM for email authentication
- [ ] Set up dedicated email service (SendGrid/Mailgun)
- [ ] Add email delivery monitoring
- [ ] Add bounce handling
- [ ] Test with 100+ organizations
- [ ] Add rate limiting for email sending

---

## Troubleshooting

### Email Not Sending

**Check SMTP Configuration:**
```bash
# View current SMTP settings
grep SMTP backend/.env

# Test SMTP connection
curl http://localhost:8080/api/ai-insights/test-email-config
```

**Common Issues:**
1. Invalid Gmail App Password → Generate new one
2. Port blocked by firewall → Use port 587 with TLS
3. Gmail account locked → Check Google account security

### Email Goes to Spam

**Solutions:**
1. Use a verified sender domain (not Gmail)
2. Configure SPF record: `v=spf1 include:_spf.google.com ~all`
3. Configure DKIM signing
4. Avoid spam trigger words in content
5. Include unsubscribe link (already done)
6. Ensure proper HTML formatting (already done)

### No Organizations Receiving Emails

**Check Database:**
```sql
-- Find organizations with owners who have emails
SELECT
  o.id as org_id,
  o.name as org_name,
  u.email,
  u.full_name
FROM organizations o
JOIN users u ON o.owner_id = u.id
WHERE u.email IS NOT NULL;
```

**Verify:**
- Organizations have owner_id set
- Users have email addresses
- Email addresses are valid format

### Email Content Looks Wrong

**Check Template Variables:**
```bash
# Verify template file exists
ls -la backend/src/templates/weekly-summary-email.html

# Preview data being sent
curl http://localhost:8080/api/ai-insights/preview-weekly-summary
```

**Common Issues:**
1. Missing Handlebars variables → Check template syntax
2. AI API not configured → Check ANTHROPIC_API_KEY
3. Database missing data → Verify tables have data

---

## Monitoring

### Check Job Status

**View Backend Logs:**
```bash
# Should see these on startup:
# [Weekly AI Summary] Email template loaded
# [Weekly AI Summary] Email transporter configured
# [Weekly AI Summary] Job scheduled - runs every Monday at 9 AM
```

**Verify Cron Schedule:**
```typescript
// In backend/src/jobs/weekly-ai-summary.job.ts
// Line 77: cron.schedule('0 9 * * 1', ...)
// This means: Every Monday at 9:00 AM
```

### Email Delivery Logs

**After Sending:**
```bash
# Check backend console output
# Should see:
# [Weekly AI Summary] Manual trigger...
# [Weekly AI Summary] Found X organizations
# [Weekly AI Summary] Sent to user@example.com
# [Weekly AI Summary] Completed: X sent, 0 errors
```

---

## Production Configuration

### Environment Variables

**Required:**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@devcontrol.app
SMTP_PASS=your-app-password
FRONTEND_URL=https://app.devcontrol.com
ANTHROPIC_API_KEY=sk-ant-...
```

**Optional:**
```bash
SMTP_FROM=DevControl <noreply@devcontrol.app>
```

### Recommended Email Service Providers

**For Production:**

1. **SendGrid** (Recommended)
   - Free tier: 100 emails/day
   - Easy setup: Just API key
   - Great deliverability
   - Built-in analytics

2. **Mailgun**
   - Free tier: 100 emails/day
   - Good for developers
   - Webhooks for tracking

3. **AWS SES**
   - Very cheap ($0.10 per 1000 emails)
   - Requires domain verification
   - Best for high volume

**Setup Example (SendGrid):**
```typescript
// Instead of nodemailer SMTP:
import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

await sgMail.send({
  to: userInfo.email,
  from: 'noreply@devcontrol.app',
  subject: 'Your DevControl Weekly Summary',
  html: emailHtml
});
```

---

## Next Steps

### Immediate (Before Launch)
1. Test email delivery to your own inbox
2. Verify all links work correctly
3. Check rendering in 2-3 email clients
4. Add user preference settings

### Short-term (Post-Launch)
1. Monitor delivery rates and bounces
2. Track open rates and click-through rates
3. Collect user feedback
4. A/B test subject lines

### Long-term (Enhancements)
1. Add weekly/monthly frequency options
2. Add more content sections (security, compliance)
3. Personalize content based on user behavior
4. Add email forwarding to team members
5. Implement digest mode (multiple weeks in one email)

---

## Support

### If Something Goes Wrong

1. **Check Backend Logs**
   - Look for error messages
   - Verify job initialization

2. **Test SMTP Connection**
   - Use test endpoint
   - Try manual SMTP test

3. **Verify Database**
   - Check organizations have owners
   - Check users have emails

4. **Review Email Template**
   - Ensure Handlebars syntax is correct
   - Test with sample data

5. **Contact Support**
   - Backend logs
   - Error messages
   - Test endpoint responses
