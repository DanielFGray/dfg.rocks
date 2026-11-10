// graphile-migrate settings. A JavaScript file, because the owner role differs per instance
// (dev, staged, live). cartridge.json names it with a database role entry: the platform sets
// it in the migrate task, and `ops dev db up` writes the dev role name to .env.
const databaseOwner = process.env.DATABASE_OWNER;
if (!databaseOwner) throw new Error("DATABASE_OWNER is not set; run `ops dev db up`");

module.exports = {
  databaseOwner,
  pgSettings: {
    search_path: "app_public,app_private,public",
  },
  placeholders: {
    ":DATABASE_VISITOR": "!ENV",
  },
  // Migrations enqueue graphile-worker jobs, so every reset database gets the worker schema first.
  afterReset: [
    // graphile-migrate recreates the shadow database empty; ops rebuilds it from the cartridge.
    { _: "command", shadow: true, command: 'ops dev db reset "$GM_DBNAME"' },
    "afterReset.sql",
    { _: "command", command: 'DATABASE_URL="$GM_DBURL" bun --cwd=worker graphile-worker --schema-only' },
  ],
  // Production images do not install kysely-codegen, so codegen runs only on the dev `current/` path.
  afterCurrent: [{ _: "command", shadow: false, command: "bun db:types --url 'env(GM_DBURL)'" }],
};
