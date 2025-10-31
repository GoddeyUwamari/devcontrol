# Commit Message Convention

Follow this format:
```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types:
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding tests
- **chore**: Build/config changes

## Examples:
```bash
feat(dashboard): add revenue chart with mock data
fix(auth): resolve token refresh infinite loop
docs(readme): update installation instructions
style(sidebar): adjust navigation spacing
refactor(api): simplify axios error handling
perf(table): optimize tenant list rendering
```

## Scope Options:
- auth, dashboard, tenants, subscriptions, invoices
- api, ui, layout, hooks, types
