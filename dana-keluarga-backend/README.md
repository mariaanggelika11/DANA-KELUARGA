# Dana Keluarga Backend

## Commands

```bash
npm install
cp .env.example .env
npx prisma validate
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run dev
npm run build
npm start
```

Production memakai `npx prisma migrate deploy`, bukan `db push`. REST API menggunakan `/health`, `/ready`, `/api/v1/auth/login`, dan `/api/v1/dashboard/summary` pada fondasi awal ini.

Isi credential PostgreSQL, JWT, seed admin, payment provider, dan WhatsApp hanya melalui `.env`. Session WhatsApp harus berada di storage persisten dan tidak boleh masuk Git.

## Role dan registrasi

`SUPER_ADMIN` adalah role global pemilik aplikasi dan dibuat melalui `SEED_SUPER_ADMIN_*`. Setelah login, Super Admin membuat keluarga beserta Admin pertama melalui `POST /api/v1/management/families`. Admin keluarga kemudian mendaftarkan user baru melalui `POST /api/v1/management/members` dengan role `MEMBER` atau `TREASURER`. Registrasi publik tidak tersedia.
