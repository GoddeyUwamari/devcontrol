# Service Rename Migration - Execution Guide

## Overview
This migration renames 6 services from test/demo names to professional production names. All foreign key relationships are preserved since services are referenced by UUID, not by name.

## Files Included
- `007_rename_services_professional.sql` - Main migration script
- `007_rollback_rename_services.sql` - Rollback script (if needed)
- `007_EXECUTION_GUIDE.md` - This file

---

## Pre-Migration Checklist

- [ ] Verify PostgreSQL connection works
- [ ] Confirm organization_id is `00000000-0000-0000-0000-000000000001`
- [ ] Create backup of services table
- [ ] Stop application (optional but recommended)
- [ ] Review migration script

---

## Step 1: Backup Current Data

### Option A: CSV Backup (Recommended)
```bash
# Create backup directory
mkdir -p /tmp/platform_backups

# Export current services to CSV
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  COPY (
    SELECT * FROM services
    WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  ) TO '/tmp/platform_backups/services_backup_$(date +%Y%m%d_%H%M%S).csv' CSV HEADER;
"
```

### Option B: SQL Dump Backup
```bash
# Full database backup
pg_dump -h localhost -U postgres -d platform_portal > /tmp/platform_backups/full_backup_$(date +%Y%m%d_%H%M%S).sql

# Or just the services table
pg_dump -h localhost -U postgres -d platform_portal -t services > /tmp/platform_backups/services_backup_$(date +%Y%m%d_%H%M%S).sql
```

---

## Step 2: Verify Current State

```bash
# Check current service names
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  SELECT id, name, template, owner
  FROM services
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  ORDER BY name;
"
```

**Expected output should show:**
- analytics-pipeline
- frontend-app
- ml-service
- payment-service
- test-api
- user-service

---

## Step 3: Run Migration

### Dry Run (Review Only - No Changes)
```bash
# Review what will change without executing updates
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal << 'EOF'
SELECT
  name AS old_name,
  CASE
    WHEN name = 'test-api' THEN 'auth-gateway'
    WHEN name = 'user-service' THEN 'customer-portal-api'
    WHEN name = 'payment-service' THEN 'checkout-service'
    WHEN name = 'analytics-pipeline' THEN 'data-ingestion-pipeline'
    WHEN name = 'frontend-app' THEN 'web-dashboard'
    WHEN name = 'ml-service' THEN 'recommendation-engine'
  END AS new_name,
  template,
  owner
FROM services
WHERE name IN (
  'test-api', 'user-service', 'payment-service',
  'analytics-pipeline', 'frontend-app', 'ml-service'
)
AND organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;
EOF
```

### Execute Migration
```bash
# Run the full migration script
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal \
  -f database/migrations/007_rename_services_professional.sql
```

**What happens:**
1. ✅ Verification queries show current state
2. ✅ Backup table created (`services_backup_20251228`)
3. ✅ Transaction begins
4. ✅ 6 services updated with new names, templates, owners, descriptions
5. ✅ Generic templates fixed (api → REST API, microservices → Microservice)
6. ✅ Transaction commits
7. ✅ Verification queries confirm changes
8. ✅ Dependency and deployment links verified

---

## Step 4: Verify Migration Success

### Check Renamed Services
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  SELECT name, template, owner, description
  FROM services
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  ORDER BY name;
"
```

**Expected output:**
| name | template | owner | description |
|------|----------|-------|-------------|
| auth-gateway | REST API | Platform Team | Authentication and authorization gateway... |
| checkout-service | Microservice | Payments Team | Payment processing with Stripe... |
| customer-portal-api | REST API | Frontend Team | Customer-facing portal backend... |
| data-ingestion-pipeline | Data Pipeline | Data Team | Real-time event streaming... |
| recommendation-engine | Microservice | ML Team | ML-powered product recommendations... |
| web-dashboard | Frontend App | Frontend Team | React-based admin dashboard... |

### Verify Dependencies Still Work
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  SELECT
    s1.name AS source_service,
    s2.name AS target_service,
    sd.dependency_type
  FROM service_dependencies sd
  JOIN services s1 ON sd.source_service_id = s1.id
  JOIN services s2 ON sd.target_service_id = s2.id
  WHERE sd.organization_id = '00000000-0000-0000-0000-000000000001';
"
```

**Should show:** All dependencies with new service names, no broken links.

### Verify Deployments Still Linked
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  SELECT
    s.name AS service_name,
    d.environment,
    d.version,
    d.status
  FROM deployments d
  JOIN services s ON d.service_id = s.id
  WHERE d.organization_id = '00000000-0000-0000-0000-000000000001'
  ORDER BY d.created_at DESC
  LIMIT 10;
"
```

**Should show:** Recent deployments with new service names.

---

## Step 5: Test Application

### Start Application
```bash
# If you stopped it earlier
npm run dev
# or
docker-compose up -d
```

### Manual Testing Checklist

- [ ] **Services Page** (`/services`)
  - Shows 6 services with new professional names
  - Templates display correctly (REST API, Microservice, etc.)
  - Owners show team names (Platform Team, Payments Team, etc.)
  - Descriptions are professional and detailed

- [ ] **Dependencies Page** (`/dependencies`)
  - Dependency graph renders without errors
  - All nodes show new service names
  - All edges (arrows) connect correctly
  - No broken references or missing nodes

- [ ] **Deployments Page** (`/deployments`)
  - Deployment history shows new service names
  - All deployments linked to correct services
  - No "Unknown service" entries

- [ ] **Monitoring/Alerts Pages**
  - Service names updated in any dropdowns
  - Historical data still accessible
  - No console errors

### Browser Console Check
Open DevTools (F12) and check for:
- ❌ No 404 errors
- ❌ No "service not found" errors
- ❌ No broken API calls

---

## Rollback (If Needed)

### When to Rollback
Only if:
- Application breaks unexpectedly
- Data integrity issues found
- Need to revert for any reason

### Execute Rollback
```bash
# This reverts all services to original test names
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal \
  -f database/migrations/007_rollback_rename_services.sql
```

### Restore from Backup (Alternative)
```bash
# Option 1: Restore from SQL dump
psql -h localhost -U postgres -d platform_portal < /tmp/platform_backups/services_backup_*.sql

# Option 2: Restore from backup table (if migration script created it)
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal << 'EOF'
BEGIN;

-- Clear current services
DELETE FROM services WHERE organization_id = '00000000-0000-0000-0000-000000000001';

-- Restore from backup
INSERT INTO services
SELECT * FROM services_backup_20251228
WHERE organization_id = '00000000-0000-0000-0000-000000000001';

COMMIT;
EOF
```

---

## Troubleshooting

### Issue: "organization_id not found"
**Solution:** Update the organization_id in the migration script to match your actual ID:
```bash
# Find your organization ID
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  SELECT id, name FROM organizations;
"
```

### Issue: "Services not found"
**Cause:** Service names already changed or don't match expected names.

**Solution:** Check current service names:
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  SELECT name FROM services ORDER BY name;
"
```

### Issue: "Foreign key violation"
**This should NOT happen** since we're only updating names, not IDs.

**If it does:**
1. Immediately rollback the transaction
2. Check what other processes are modifying services
3. Review migration script for unintended changes

### Issue: Dependencies graph shows old names
**Solution:**
1. Clear browser cache (Ctrl+Shift+R)
2. Restart the application
3. Check if frontend is caching service data

---

## Post-Migration Cleanup

### After Confirming Success (Wait 24-48 hours)

```bash
# Drop the backup table
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal -c "
  DROP TABLE IF EXISTS services_backup_20251228;
"

# Remove CSV backups (optional)
rm /tmp/platform_backups/services_backup_*.csv
```

---

## Migration Checklist Summary

**Pre-Migration:**
- [x] Backed up services table
- [x] Verified current service names
- [x] Reviewed migration script

**Migration:**
- [ ] Executed `007_rename_services_professional.sql`
- [ ] Verified no errors during execution
- [ ] Checked services renamed correctly

**Post-Migration:**
- [ ] Tested /services page
- [ ] Tested /dependencies page
- [ ] Tested /deployments page
- [ ] No console errors
- [ ] All data intact

**Final:**
- [ ] Application running smoothly for 24+ hours
- [ ] Cleanup backup tables (optional)

---

## Expected Timeline

- **Backup:** 1 minute
- **Migration execution:** < 1 second (6 UPDATE statements)
- **Verification:** 2-3 minutes
- **Application testing:** 5-10 minutes
- **Total:** ~15 minutes

---

## Support

If you encounter issues:

1. **Check verification queries** - They'll show if dependencies/deployments broke
2. **Review PostgreSQL logs** - Look for any constraint violations
3. **Test each page manually** - Services, Dependencies, Deployments
4. **Rollback if needed** - Better safe than sorry

---

## Database Connection String

```bash
# Standard connection
PGPASSWORD=postgres psql -h localhost -U postgres -d platform_portal

# Or using connection string
psql postgresql://postgres:postgres@localhost:5432/platform_portal
```

---

## Success Criteria

✅ All 6 services renamed to professional names
✅ No broken foreign key relationships
✅ Dependencies graph displays correctly
✅ Deployments still linked to services
✅ No application errors
✅ Professional descriptions and team owners assigned

---

**Migration Author:** Platform Team
**Migration Date:** 2025-12-28
**Estimated Risk:** Low (Only updates name field, preserves all UUIDs)
**Reversible:** Yes (Rollback script provided)
