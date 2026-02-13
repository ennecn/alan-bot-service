# AGENTS.md - OpenClaw Workspace

## Build, Test & Development Commands

### Next.js Projects (MkSaaS Template)
```bash
# Development
pnpm dev              # Start Next.js dev server
pnpm build            # Production build
pnpm start            # Start production server

# Code Quality
pnpm lint             # Run Biome linter (--write to fix)
pnpm format           # Format code with Biome

# Database (Drizzle)
pnpm db:generate      # Generate migrations from schema
pnpm db:migrate       # Apply pending migrations
pnpm db:push          # Push schema to database (dev only)
pnpm db:studio        # Open Drizzle Studio

# Other
pnpm email            # Email template dev server
```

### Node.js Servers (llm-gateway)
```bash
npm run dev           # Start with --watch mode
npm start             # Production start
```

### Cloudflare Workers (clawhive-api)
```bash
pnpm dev              # Wrangler dev
pnpm deploy           # Deploy to Cloudflare
pnpm test             # Run Vitest
pnpm cf-typegen       # Generate CF types
```

### Running Single Tests
```bash
# Vitest (Cloudflare projects)
pnpm test -- src/utils.test.ts
pnpm test -- --reporter=verbose

# No test runner configured for Next.js projects yet
# Add tests with .test.ts(x) or .spec.ts(x) suffix
```

---

## Code Style & Conventions

### Formatting (Biome)
- **Indent**: 2 spaces (not tabs)
- **Quotes**: Single quotes
- **Trailing commas**: ES5 style
- **Semicolons**: Required
- **Line width**: 80 characters
- **Formatter**: Biome (configured in biome.json)

### Naming Conventions
- **Files**: kebab-case (`dashboard-sidebar.tsx`)
- **Components**: PascalCase (`DashboardSidebar`)
- **Hooks**: use- prefix (`use-session.ts`)
- **Utils**: camelCase, named exports (`export function formatDate`)
- **Types/Interfaces**: PascalCase

### TypeScript
- Enable strict mode
- Use interfaces for object shapes
- Use types for unions/intersections
- Leverage type inference
- Prefer generics for reusable components
- Use strict null checks

### Imports
- **NEXT.JS 15+**: Use direct imports (avoid barrel files for large libs)
  ```typescript
  // Good - direct import
  import Check from 'lucide-react/dist/esm/icons/check'
  
  // Avoid - loads entire library
  import { Check } from 'lucide-react'
  ```
- Organize imports enabled (Biome)
- Use `@/` path aliases for project imports

### React Patterns
- **Components**: Functional components with hooks
- **State**: Zustand for client state, URL/server for server state
- **Forms**: react-hook-form + Zod validation
- **Server Actions**: Always authenticate inside action
- **React 19**: Use `use()` instead of `useContext()`, `ref` as regular prop

### Error Handling
- Use error.tsx and not-found.tsx in Next.js
- Implement proper try/catch in async operations
- Use `next-safe-action` for form submissions
- Never use empty catch blocks

### Performance
- Use `Promise.all()` for independent async ops
- Defer non-critical third-party libs (analytics)
- Dynamic import heavy components
- Use React.cache() for request deduplication
- Minimize serialization at RSC boundaries

---

## Project Structure

### Next.js (MkSaaS)
```
src/
  app/              # Next.js App Router
    [locale]/       # i18n routes
  components/       # React components
    ui/             # Base UI components
  lib/              # Utilities
  db/               # Drizzle schema/migrations
  stores/           # Zustand stores
  actions/          # Server Actions
  hooks/            # Custom hooks
  types/            # TypeScript types
content/            # MDX content
```

### Node.js (llm-gateway)
```
server.js           # Main entry
router.js           # Route definitions
db.js               # Database layer
package.json
```

### Cloudflare Workers
```
src/
  index.ts          # Main worker
package.json
wrangler.toml
tsconfig.json
```

---

## Cursor Rules Reference

This repo has extensive Cursor rules in `.cursor/rules/` (MkSaaS project):
- `typescript-best-practices.mdc`
- `react-best-practices.mdc`
- `nextjs-best-practices.mdc`
- `zustand-best-practices.mdc`
- `drizzle-orm-best-practices.mdc`
- `tailwindcss-best-practices.mdc`
- `development-workflow.mdc`

Also see skill-specific AGENTS.md files:
- `skills/react-best-practices/AGENTS.md`
- `skills/composition-patterns/AGENTS.md`

---

## Commit Guidelines

- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`
- Keep commits scoped and atomic
- Reference issue IDs in commit body
- Update env.example when adding env vars

---

## Security

- Never commit secrets to git
- Use env.example as template
- Store production credentials with deployment provider
- Always authenticate inside Server Actions
- Validate inputs with Zod

---

## Testing Guidelines

- No automated tests currently wired (MkSaaS)
- Validate with `pnpm dev`, linting, and manual QA
- When adding tests: colocate with feature using `.test.ts(x)` suffix
- Use Vitest for Cloudflare Workers

---

*This AGENTS.md was generated for the OpenClaw workspace. Update as patterns evolve.*
