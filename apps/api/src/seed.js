import crypto from 'node:crypto';
import { pool, transaction } from './db.js';
import { runMigrations } from './migrate.js';

const id = value => value;
const ids = {
  customer: id('11111111-1111-4111-8111-111111111111'),
  email: id('22222222-2222-4222-8222-222222222222'),
  phone: id('33333333-3333-4333-8333-333333333333'),
  order: id('44444444-4444-4444-8444-444444444444'),
  item: id('55555555-5555-4555-8555-555555555555'),
  communication: id('66666666-6666-4666-8666-666666666666'),
  case: id('77777777-7777-4777-8777-777777777777')
};
const now = new Date('2026-09-04T12:00:00.000Z');

async function seed() {
  if ((process.env.APP_ENV || 'development') !== 'development') {
    throw new Error('seed is restricted to APP_ENV=development');
  }
  await runMigrations();
  await transaction(async client => {
    await client.query('TRUNCATE audit_events, approvals, role_permissions, user_roles, permissions, roles, users, case_events, operational_events, cases, communications, order_line_items, orders, customer_identifiers, customers, ingestion_receipts CASCADE');
    const roleIds = {};
    for (const role of ['OWNER', 'OPERATIONS', 'CSR', 'FULFILLMENT', 'AGENT']) {
      const roleId = crypto.randomUUID();
      roleIds[role] = roleId;
      await client.query('INSERT INTO roles(id, name) VALUES ($1, $2)', [roleId, role]);
    }
    const permissionNames = [...new Set(Object.values((await import('./domain.js')).ROLE_PERMISSIONS).flat())];
    const permissionIds = {};
    for (const permission of permissionNames) {
      const permissionId = crypto.randomUUID();
      permissionIds[permission] = permissionId;
      await client.query('INSERT INTO permissions(id, name) VALUES ($1, $2)', [permissionId, permission]);
    }
    for (const [role, permissions] of Object.entries((await import('./domain.js')).ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        await client.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1, $2)', [roleIds[role], permissionIds[permission]]);
      }
    }
    const ownerId = crypto.randomUUID();
    await client.query('INSERT INTO users(id, username, display_name, created_at) VALUES ($1, $2, $3, $4)', [ownerId, 'dev-owner', 'Development Owner', now]);
    await client.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1, $2)', [ownerId, roleIds.OWNER]);
    await client.query('INSERT INTO customers(id, display_name, email, phone, lifetime_value, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)', [ids.customer, 'Sarah Test', 'sarah.customer@test.local', '+15550001001', 129.99, now]);
    await client.query('INSERT INTO customer_identifiers(id, customer_id, source, identifier_type, normalized_value, verified, provenance, created_at) VALUES ($1,$2,$3,$4,$5,true,$6,$7),($8,$2,$3,$9,$10,true,$11,$7)', [ids.email, ids.customer, 'fixture', 'email', 'sarah.customer@test.local', JSON.stringify({fixture: 'new-customer'}), now, ids.phone, 'phone', '+15550001001', JSON.stringify({fixture: 'new-customer'})]);
    await client.query('INSERT INTO orders(id, customer_id, source, external_order_id, order_number, amount, payment_status, fulfillment_status, source_created_at, source_updated_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$9)', [ids.order, ids.customer, 'woocommerce-fixture', 'TEST-WOO-10001', 'TEST-ORDER-10001', 129.99, 'PAID', 'DELIVERED', now]);
    await client.query('INSERT INTO order_line_items(id, order_id, source_product_id, sku, product_name, quantity, unit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)', [ids.item, ids.order, 'TEST-PRODUCT-001', 'TEST-SKU-001', 'Synthetic Test Vial', 1, 129.99]);
    await client.query('INSERT INTO communications(id, customer_id, source, channel, external_id, direction, content_reference, summary, occurred_at, source_observed_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9)', [ids.communication, ids.customer, 'twilio-fixture', 'SMS', 'SM-TEST-DAMAGED-10001', 'INBOUND', 'fixture://customer-scenarios/damaged-product/message.json', 'My order arrived but one of the vials is broken.', new Date('2026-09-04T13:00:00Z')]);
    await client.query('INSERT INTO cases(id, customer_id, order_id, case_type, priority, status, owner_scope, requires_human, financial_action, fulfillment_action, source, source_reference, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$12)', [ids.case, ids.customer, ids.order, 'DAMAGED_PRODUCT', 'HIGH', 'OPEN', 'CSR', 'NONE', 'NONE', 'fixture', 'SM-TEST-DAMAGED-10001', now]);
    await client.query('INSERT INTO operational_events(id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10),($11,$2,$3,$12,$5,$13,$7,$14,$9,$10),($15,$2,$3,$16,$17,$18,$19,$20,$9,$10),($21,$2,$3,$22,$23,$24,$25,$26,$9,$10)', [crypto.randomUUID(), ids.customer, ids.order, 'CUSTOMER_CREATED', 'fixture', 'customer-10001', 'SYSTEM', now, now, JSON.stringify({fixture: 'new-customer'}), crypto.randomUUID(), 'ORDER_CREATED', 'order-10001', new Date('2026-09-04T12:01:00Z'), crypto.randomUUID(), 'ORDER_DELIVERED', 'woocommerce-fixture', 'TEST-WOO-10001', 'SOURCE', new Date('2026-09-04T12:02:00Z'), crypto.randomUUID(), 'CUSTOMER_MESSAGE_RECEIVED', 'twilio-fixture', 'SM-TEST-DAMAGED-10001', 'CUSTOMER', new Date('2026-09-04T13:00:00Z')]);
    await client.query('INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)', [crypto.randomUUID(), ids.case, 'CASE_CREATED', 'Damaged product case created from inbound synthetic message', 'SYSTEM', new Date('2026-09-04T13:00:01Z')]);
  });
  console.log(JSON.stringify({status: 'seeded', customer: 'Sarah Test', order: 'TEST-ORDER-10001', case_type: 'DAMAGED_PRODUCT', case_status: 'OPEN'}));
}
seed().then(() => pool.end()).catch(async error => { console.error(error.message); await pool.end(); process.exit(1); });
