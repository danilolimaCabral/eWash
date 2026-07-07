# Pull Request

## Summary

Describe what changed and why.

## Type of Change

- [ ] Bug fix
- [ ] Feature
- [ ] UI change
- [ ] Refactor
- [ ] Documentation
- [ ] Database migration
- [ ] Security-sensitive change

## Verification

List the checks you ran:

```bash
bun run build
bun run db:migrate:local
```

## Data and Security Checklist

- [ ] Tenant data remains tenant-scoped.
- [ ] Branch access is enforced where relevant.
- [ ] Protected routes use the correct policy middleware.
- [ ] Financial, billing, pricing, and administrative mutations are audit logged.
- [ ] No secrets, private data, or debug logs are included.
- [ ] Migrations are generated and named when schema changes are included.

## Screenshots

Add screenshots for UI changes.
