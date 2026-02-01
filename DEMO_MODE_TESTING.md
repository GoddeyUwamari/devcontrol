# Sales Demo Mode - Testing Guide

## ✅ What's Been Implemented

### 1. Demo Data Infrastructure
- ✅ **30+ AWS Resources** (`lib/demo-data/demo-generator.ts`)
  - 6 EC2 instances (production, staging, dev)
  - 3 RDS databases
  - 5 Lambda functions
  - 3 S3 buckets
  - 4 EBS volumes
  - 3 Elastic IPs
  - 2 Load Balancers
  - ElastiCache, ECS, CloudFront
  - **Total Monthly Cost: ~$6,847**

### 2. Demo Mode Service (`lib/services/demo-mode.service.ts`)
- ✅ Enable/disable demo mode (localStorage)
- ✅ Get demo AWS resources
- ✅ Get demo statistics
- ✅ Get 6 cost optimization recommendations ($471/month savings)
- ✅ Get 3 active anomalies with AI explanations

### 3. Service Integration
- ✅ **Optimization Service** (`lib/services/optimization.service.ts`)
  - Returns demo optimizations when demo mode enabled
  - Includes proper summary calculations
  - Filters by status correctly

- ✅ **Anomaly Service** (`lib/services/anomaly.service.ts`)
  - Returns demo anomalies when demo mode enabled
  - Includes demo statistics
  - Filters by status correctly

### 4. UI Components
- ✅ **DemoModeToggle** (`components/demo/demo-mode-toggle.tsx`)
  - Bottom-right floating button
  - Shows "Demo Mode ON/OFF"
  - Persists in localStorage

- ✅ **DemoModeBanner** (`components/demo/DemoModeBanner.tsx`)
  - Purple gradient banner when demo active
  - Shows demo data overview
  - Exit button to disable demo mode

- ✅ **Layout Integration** (`app/(app)/layout.tsx`)
  - Both components already added to layout
  - Visible on all authenticated pages

## 🧪 How to Test

### Step 1: Start the Frontend
```bash
cd /Users/user/Desktop/platform-portal
npm run dev
```

### Step 2: Navigate to Dashboard
Open browser: http://localhost:3010/dashboard

### Step 3: Enable Demo Mode
Look for the **"Demo Mode OFF"** button at bottom-right of screen and click it.

**Expected Result:**
- Page reloads
- Button changes to **"Demo Mode ON"**
- (If banner implemented) Purple banner appears at top

### Step 4: Verify Cost Optimization Page
Navigate to: http://localhost:3010/cost-optimization

**Expected Demo Data:**
- **6 recommendations** total
- **$471/month savings** (~$5,652/year)
- **Recommendations:**
  1. Idle EC2: staging-old-server ($178/mo)
  2. Oversized EC2: dev-testing-environment ($223/mo)
  3. Unattached EBS: old-backup-volume ($25/mo)
  4. Unattached EBS: testing-snapshot-volume ($10/mo)
  5. Unused Elastic IP: old-staging-ip ($3.65/mo)
  6. Over-provisioned Lambda: webhook-handler ($31.56/mo)

### Step 5: Verify Anomaly Detection Page
Navigate to: http://localhost:3010/anomalies

**Expected Demo Data:**
- **3 active anomalies**
- **Anomalies:**
  1. 🔴 **Critical**: High CPU on production-worker-overloaded (92% vs 45% normal)
  2. ⚠️ **Warning**: Lambda invocation spike on payment-processor (178% increase)
  3. ⚠️ **Warning**: AWS cost spike (14.4% increase, $864 extra)
- Each anomaly should have:
  - AI explanation
  - Impact analysis
  - Detailed recommendations

### Step 6: Verify Dashboard Stats
Navigate to: http://localhost:3010/dashboard

**Expected Demo Data:**
- **30 resources** total
- **~$6,847/month** total cost
- **14.3% cost increase** (if stat shown)
- Resource breakdown by type:
  - EC2: 6
  - RDS: 3
  - Lambda: 5
  - S3: 3
  - EBS: 4
  - ELB: 2

### Step 7: Disable Demo Mode
Click **"Demo Mode ON"** button (or "Exit Demo Mode" in banner)

**Expected Result:**
- Page reloads
- Returns to real data (or empty state if no real data)
- Button shows **"Demo Mode OFF"**

## 📊 Demo Data Highlights

### Cost Optimizations (6 recommendations)
- **Total Savings**: $471/month ($5,652/year)
- **Risk Distribution**: 3 Safe, 2 Caution, 0 Risky
- **By Type**:
  - 2 Idle resources
  - 2 Unattached volumes
  - 1 Oversized instance
  - 1 Over-provisioned Lambda

### Anomalies (3 active)
- **Severity**: 1 Critical, 2 Warning
- **Types**: CPU spike, Lambda spike, Cost spike
- **All Include**: AI explanations, impact, recommendations

### AWS Resources (30 total)
- **Monthly Cost**: $6,847.20
- **Regions**: us-east-1, us-west-2, global
- **Environments**: Production, Staging, Development
- **Realistic Metrics**: CPU usage, memory, invocations, storage

## 🎯 Sales Demo Use Cases

### 1. Marketing Screenshots
- Enable demo mode
- Navigate to Cost Optimization
- Take screenshot of recommendations table
- Shows professional, realistic data

### 2. Sales Call Demo
- Enable demo mode before call
- Walk through dashboard → optimizations → anomalies
- Show AI explanations and recommendations
- Disable after call

### 3. Product Hunt Launch
- Enable demo mode
- Record screen demo video
- Show all features with populated data
- Professional impression

### 4. Social Media Posts
- Enable demo mode
- Screenshot anomaly AI explanations
- Post on Twitter/LinkedIn
- Demonstrate value prop

### 5. Internal Training
- Enable demo mode for new sales team
- Practice sales narrative
- Familiarize with product features
- No AWS account needed

## 🐛 Troubleshooting

### Demo Mode Not Enabling
1. Check browser console for errors
2. Verify localStorage support: `localStorage.getItem('devcontrol_demo_mode')`
3. Try incognito window to clear state

### Demo Data Not Showing
1. Verify demo mode is ON (check button)
2. Clear localStorage: `localStorage.clear()` then re-enable
3. Check browser console for service errors
4. Refresh page after enabling

### Button Not Visible
1. Check z-index conflicts
2. Verify `app/(app)/layout.tsx` includes `<DemoModeToggle />`
3. Try different page (should show on all authenticated pages)

## 📝 Notes

- Demo mode uses **localStorage** (persists across sessions)
- Demo data is **client-side only** (no API calls)
- Safe to use in production (doesn't affect real data)
- Each page refresh checks localStorage state
- Demo toggle works on all authenticated pages

## 🚀 Next Steps

### Optional Enhancements
1. Add keyboard shortcut (D key) to toggle demo mode
2. Add demo mode indicator to TopNav
3. Export demo data as JSON for testing
4. Add more resource types (DynamoDB, SQS, SNS)
5. Create demo mode for DORA metrics page

### Marketing Checklist
- [ ] Take 5 screenshots with demo mode enabled
- [ ] Record 2-minute demo video
- [ ] Update Product Hunt images
- [ ] Create social media graphics
- [ ] Train sales team on demo mode usage

## 💡 Pro Tips

1. **Always verify demo mode state** before presenting
2. **Disable demo mode** after screenshots/demos
3. **Practice demo flow** with demo mode before sales calls
4. **Use incognito** for clean demo presentations
5. **Take screenshots** at 1920x1080 resolution for best quality

---

**Implementation Complete!** 🎉

All demo mode infrastructure is in place and ready for testing. Enable demo mode and explore the realistic AWS infrastructure data, cost optimizations, and anomaly detections.
