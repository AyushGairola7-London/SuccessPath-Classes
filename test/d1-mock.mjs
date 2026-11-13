// A small stand-in for Cloudflare D1, built on the SQLite that comes with Node.js (22.5 or newer).
// Used by the tests and by `npm run try`. It behaves like D1 for the calls this app makes.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function createD1(path = ':memory:', migrationsDir = null) {
  const db = new DatabaseSync(path);
  if (migrationsDir) {
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }
  }
  return new D1Database(db);
}

class D1Database {
  constructor(db) {
    this.sqlite = db;
  }

  prepare(sql) {
    return new D1PreparedStatement(this.sqlite, sql, []);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((s) => s.runAll());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1 };
  }
}

class D1PreparedStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    for (const p of params) {
      if (p === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
      if (typeof p === 'object' && p !== null) throw new Error('D1_TYPE_ERROR: objects cannot be bound');
    }
    return new D1PreparedStatement(this.db, this.sql, params.map((p) => (typeof p === 'boolean' ? Number(p) : p)));
  }

  async first(column) {
    const rows = this.rows();
    if (rows.length === 0) return null;
    return column ? rows[0][column] : rows[0];
  }

  async all() {
    return this.runAll();
  }

  async run() {
    return this.runAll();
  }

  runAll() {
    const results = this.rows();
    return { success: true, results, meta: {} };
  }

  rows() {
    const statement = this.db.prepare(this.sql);
    return statement.all(...this.params).map((row) => ({ ...row }));
  }
}
