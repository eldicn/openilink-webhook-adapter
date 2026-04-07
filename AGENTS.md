# Agent Coding Guidelines

This project is a lightweight Node.js/Express webhook adapter using ES modules.

## Project Structure

```
.
├── server.js          # Main application entry
├── config/config.json # Runtime configuration
├── package.json      # Dependencies and scripts
├── Dockerfile        # Container definition
└── docker-compose.yml # Docker orchestration
```

## Build & Run Commands

```bash
# Install dependencies
npm install

# Start the server
npm start
# or: node server.js

# Run with Docker
docker compose -p openilink-webhook-adapter build --no-cache
docker compose -p openilink-webhook-adapter up -d
```

### Testing

This project currently has **no test suite**. When adding tests:
- Use Jest or Vitest as the test runner
- Place tests in a `tests/` directory
- Run a single test file: `npm test -- tests/filename.test.js`
- Run a single test: `npm test -- --testNamePattern="test name"`

Example test script to add to `package.json`:
```json
"test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
"test:watch": "npm test -- --watch"
```

### Linting

No linting is configured. Consider adding ESLint:
```bash
npm install --save-dev eslint
npx eslint server.js
```

## Code Style Guidelines

### General Principles

- Use **ES Modules** (`import`/`export`) - the project uses `"type": "module"` in package.json
- Keep functions small and focused (single responsibility)
- Add Chinese comments for complex logic (matching existing codebase style)
- Use descriptive variable and function names

### Naming Conventions

- **Files**: kebab-case (e.g., `webhook-handler.js`)
- **Functions**: camelCase, verb-prefixed (e.g., `loadConfig`, `sendWithRetry`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `CONFIG_PATH`)
- **Internal functions**: prefix with underscore if private (e.g., `_helperFunc`)

### Import Order

```javascript
// 1. Node built-ins
import fs from 'fs'
import path from 'path'

// 2. External packages
import express from 'express'
import fetch from 'node-fetch'

// 3. Local modules (relative paths)
import { helper } from './utils/helper.js'
```

### Error Handling

- Use try/catch for synchronous operations that may fail
- Wrap async operations in try/catch for network requests
- Always log errors with context before exiting or returning
- Exit with `process.exit(1)` on fatal configuration errors
- Return error objects rather than throwing in handlers

Example pattern:
```javascript
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  } catch (e) {
    log('error', 'Failed to load config.json:', e.message)
    process.exit(1)
  }
}
```

### Logging

- Use the centralized `log(level, ...args)` function
- Levels: `log`, `warn`, `error`
- Include contextual data (target name, IP, attempt number)
- Log before and after transformations for debugging

### Async/Await

- Always handle errors in async functions
- Use `Promise.all` for parallel operations when appropriate
- Use `for...of` with `await` for sequential operations when order matters

### Configuration

- Store configuration in `config/config.json`
- Load config per-request when it may change at runtime
- Validate required fields and exit on missing critical config

### HTTP Handling

- Send retry on failure with exponential backoff
- Log all HTTP responses (status and body)
- Return success/failure status in response, not HTTP error codes

### Type Safety

- This project uses plain JavaScript (no TypeScript)
- Add JSDoc comments for complex functions when needed
- Validate JSON structure at config load time

### Docker

- Expose port 3000
- Mount `./config:/app/config` for configuration
- Include health check endpoint at `/health`

## Future Improvements

When expanding this codebase, consider:
1. Adding unit tests with Jest
2. Setting up ESLint with a Node.js config
3. Adding TypeScript for better type safety
4. Splitting `server.js` into modular handlers
5. Adding request validation middleware