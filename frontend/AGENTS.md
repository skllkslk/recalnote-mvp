# RecallNote frontend

Next.js App Router + React + Tailwind CSS v4 project.

## Development

- `src/app/page.tsx` is the interactive MVP UI and is a Client Component.
- `src/app/layout.tsx` defines the root document and metadata.
- `src/app/globals.css` contains global styles and imports Tailwind CSS.
- `src/app/api/v1/[...path]/route.ts` proxies browser API requests to the Spring Boot API. Set `API_BASE_URL` when the API is not at `http://localhost:8080`.
- `package.json` contains the Next.js development, production build, start, and format scripts.
- `.mise.toml` pins Node.js and pnpm versions.

Run `pnpm dev` to start the app. Next.js uses `PORT` when supplied and defaults to port 3000.

## Styling

Tailwind CSS v4 is wired through `@tailwindcss/postcss` in `postcss.config.mjs`. Keep CSS imports at the top of `src/app/globals.css`. Global element styles belong inside `@layer base` so Tailwind utility classes can override them.
