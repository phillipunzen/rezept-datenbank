// Schema-Migrationen. Jede Migration läuft genau einmal (Tabelle schema_migrations).
export const migrations = [
  {
    id: '001_initial',
    async up(knex) {
      await knex.schema.createTable('users', (t) => {
        t.increments('id');
        t.string('email', 190).unique();
        t.string('username', 100).unique();
        t.string('display_name', 150).notNullable();
        t.string('password_hash', 200);
        t.string('oidc_sub', 190).unique();
        t.string('role', 20).notNullable().defaultTo('user');
        t.string('locale', 10).notNullable().defaultTo('de');
        t.string('theme', 10).notNullable().defaultTo('system');
        t.string('avatar', 200);
        t.integer('token_version').notNullable().defaultTo(0);
        t.boolean('disabled').notNullable().defaultTo(false);
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('last_login_at').nullable();
      });

      await knex.schema.createTable('settings', (t) => {
        t.string('key', 100).primary();
        t.text('value', 'longtext');
      });

      await knex.schema.createTable('groups', (t) => {
        t.increments('id');
        t.string('name', 150).notNullable();
        t.text('description');
        t.string('color', 20);
        t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('group_members', (t) => {
        t.integer('group_id').unsigned().notNullable().references('groups.id').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.string('role', 20).notNullable().defaultTo('editor'); // owner | editor | viewer
        t.timestamp('joined_at').defaultTo(knex.fn.now());
        t.primary(['group_id', 'user_id']);
      });

      await knex.schema.createTable('group_invites', (t) => {
        t.string('token', 64).primary();
        t.integer('group_id').unsigned().notNullable().references('groups.id').onDelete('CASCADE');
        t.string('role', 20).notNullable().defaultTo('editor');
        t.integer('created_by').unsigned().references('users.id').onDelete('CASCADE');
        t.timestamp('expires_at').nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('recipes', (t) => {
        t.increments('id');
        t.integer('owner_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('group_id').unsigned().nullable().references('groups.id').onDelete('SET NULL');
        t.string('title', 255).notNullable();
        t.text('description');
        t.decimal('servings', 8, 2).defaultTo(4);
        t.string('servings_unit', 50);
        t.integer('prep_time');
        t.integer('cook_time');
        t.integer('rest_time');
        t.string('difficulty', 20);
        t.string('category', 100);
        t.json('tags');
        t.json('ingredients');
        t.json('steps');
        t.json('nutrition');
        t.text('notes');
        t.string('source_url', 1000);
        t.text('source_note');
        t.string('image', 200);
        t.json('images');
        t.boolean('thermomix').notNullable().defaultTo(false);
        t.string('tm_model', 20);
        t.boolean('is_public').notNullable().defaultTo(false);
        t.string('public_slug', 120).unique();
        t.timestamp('published_at').nullable();
        t.text('search_text', 'mediumtext');
        t.integer('updated_by').unsigned().nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('updated_at').defaultTo(knex.fn.now());
        t.timestamp('deleted_at').nullable();
        t.index(['owner_id']);
        t.index(['group_id']);
        t.index(['deleted_at']);
      });

      await knex.schema.createTable('recipe_versions', (t) => {
        t.increments('id');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
        t.string('change_note', 255);
        t.json('snapshot');
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('recipe_favorites', (t) => {
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.primary(['user_id', 'recipe_id']);
      });

      await knex.schema.createTable('recipe_ratings', (t) => {
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.tinyint('rating').notNullable();
        t.timestamp('updated_at').defaultTo(knex.fn.now());
        t.primary(['user_id', 'recipe_id']);
      });

      // Persönliche Notizen und persönliche Anpassungen eines Rezepts
      await knex.schema.createTable('recipe_personal', (t) => {
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.text('note');
        t.json('variant'); // { servings, ingredients, steps, notes } oder null
        t.boolean('offline').notNullable().defaultTo(false);
        t.timestamp('updated_at').defaultTo(knex.fn.now());
        t.primary(['user_id', 'recipe_id']);
      });

      await knex.schema.createTable('recipe_shares', (t) => {
        t.increments('id');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE');
        t.integer('group_id').unsigned().nullable().references('groups.id').onDelete('CASCADE');
        t.string('permission', 10).notNullable().defaultTo('view');
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('share_links', (t) => {
        t.increments('id');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.string('token', 64).notNullable().unique();
        t.integer('created_by').unsigned().references('users.id').onDelete('CASCADE');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('revoked_at').nullable();
      });

      await knex.schema.createTable('cook_log', (t) => {
        t.increments('id');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.timestamp('cooked_at').defaultTo(knex.fn.now());
        t.decimal('servings', 8, 2);
        t.text('notes');
        t.tinyint('rating');
      });

      await knex.schema.createTable('cookbooks', (t) => {
        t.increments('id');
        t.integer('owner_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('group_id').unsigned().nullable().references('groups.id').onDelete('CASCADE');
        t.string('name', 150).notNullable();
        t.text('description');
        t.string('color', 20);
        t.string('icon', 40);
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('cookbook_recipes', (t) => {
        t.integer('cookbook_id').unsigned().notNullable().references('cookbooks.id').onDelete('CASCADE');
        t.integer('recipe_id').unsigned().notNullable().references('recipes.id').onDelete('CASCADE');
        t.integer('added_by').unsigned().nullable();
        t.timestamp('added_at').defaultTo(knex.fn.now());
        t.primary(['cookbook_id', 'recipe_id']);
      });

      await knex.schema.createTable('meal_plan', (t) => {
        t.increments('id');
        t.integer('owner_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('group_id').unsigned().nullable().references('groups.id').onDelete('CASCADE');
        t.date('date').notNullable();
        t.string('meal', 20).notNullable(); // breakfast | lunch | dinner | snack
        t.integer('recipe_id').unsigned().nullable().references('recipes.id').onDelete('SET NULL');
        t.string('title', 255);
        t.decimal('servings', 8, 2);
        t.text('note');
        t.integer('sort').defaultTo(0);
        t.integer('created_by').unsigned().nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['date']);
      });

      await knex.schema.createTable('shopping_lists', (t) => {
        t.increments('id');
        t.integer('owner_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('group_id').unsigned().nullable().references('groups.id').onDelete('CASCADE');
        t.string('name', 150).notNullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('updated_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('shopping_items', (t) => {
        t.increments('id');
        t.integer('list_id').unsigned().notNullable().references('shopping_lists.id').onDelete('CASCADE');
        t.string('name', 255).notNullable();
        t.decimal('amount', 12, 3).nullable();
        t.string('unit', 50);
        t.string('note', 255);
        t.string('category', 50);
        t.boolean('checked').notNullable().defaultTo(false);
        t.integer('checked_by').unsigned().nullable();
        t.json('sources');
        t.integer('sort').defaultTo(0);
        t.integer('created_by').unsigned().nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('updated_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('ha_links', (t) => {
        t.increments('id');
        t.integer('list_id').unsigned().notNullable().references('shopping_lists.id').onDelete('CASCADE');
        t.string('entity_id', 190).notNullable();
        t.timestamp('last_sync').nullable();
        t.text('last_error');
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('ha_item_map', (t) => {
        t.integer('link_id').unsigned().notNullable().references('ha_links.id').onDelete('CASCADE');
        t.integer('item_id').unsigned().notNullable();
        t.string('ha_uid', 190).notNullable();
        t.string('ha_summary', 255);
        t.string('ha_status', 20);
        t.primary(['link_id', 'item_id']);
      });

      await knex.schema.createTable('pantry_items', (t) => {
        t.increments('id');
        t.integer('owner_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('group_id').unsigned().nullable().references('groups.id').onDelete('CASCADE');
        t.string('name', 255).notNullable();
        t.decimal('amount', 12, 3).nullable();
        t.string('unit', 50);
        t.date('best_before').nullable();
        t.string('category', 50);
        t.timestamp('updated_at').defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('import_jobs', (t) => {
        t.increments('id');
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.string('type', 30).notNullable();
        t.string('status', 20).notNullable().defaultTo('running');
        t.integer('total').defaultTo(0);
        t.integer('done').defaultTo(0);
        t.json('report');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('finished_at').nullable();
      });

      await knex.schema.createTable('ai_usage', (t) => {
        t.increments('id');
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
        t.string('feature', 40);
        t.string('status', 20);
        t.integer('input_tokens');
        t.integer('output_tokens');
        t.string('error', 500);
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });
    },
  },
];

export async function runMigrations(knex) {
  const has = await knex.schema.hasTable('schema_migrations');
  if (!has) {
    await knex.schema.createTable('schema_migrations', (t) => {
      t.string('id', 100).primary();
      t.timestamp('run_at').defaultTo(knex.fn.now());
    });
  }
  const done = new Set((await knex('schema_migrations').select('id')).map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    console.log(`[db] Migration ${m.id} …`);
    await m.up(knex);
    await knex('schema_migrations').insert({ id: m.id });
  }
}
