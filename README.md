# Plines Workload Manager

Plines is an easy-to-use workload management app for juggling multiple projects and the employees working on them. It gives you a quick view into what is happening, who is overloaded, and where you still have capacity without forcing heavyweight processes or complex tooling.

## What You Get
- Built with Bun and modern web tooling for quick startup and iterative tweaks.
- Ships as a Docker container so you can run it locally or drop it on your own infrastructure.
- Focused on one thing: helping me keep track of workloads across projects. It is intentionally small in scope.

## Run with Docker Compose
1. Review `.env` and adjust credentials or secrets if needed.
2. Start everything with:
   ```bash
   docker compose up --build
   ```
3. Visit `http://localhost:3000` after the containers finish building. A Postgres instance is provisioned automatically and scheduled backups land in `./backups`.

Stop the stack with `docker compose down`. Add `-v` if you also want to remove the database volume.

## Configuration
- Copy `.env.example` to `.env` before deploying or running the stack.
- Fill in a production-grade `DATABASE_URL`, generate a long random `SECRET_KEY`, and choose strong admin credentials.
- Docker Compose reads `.env` automatically and passes any `APP_*` values into the service containers; update them if you need to override the defaults.
- When hosting in production, mount or inject the same variables as environment secrets instead of committing `.env`.

## Development via Bun
If you prefer running Bun directly:
```bash
bun install
bun dev
```
The app will be available at `http://localhost:3000`.

## Important Notes
- This is a personal, vibe-coded project. It solves my problem right now, not every workload management problem ever.
- Expect sharp edges: no promises about long-term support, security, or backwards compatibility.
- Breaking changes may appear without notice. Use it entirely at your own risk.
