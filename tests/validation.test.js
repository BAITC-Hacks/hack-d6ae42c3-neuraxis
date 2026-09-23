import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validEmail } from '../src/shared/validation.js';
test('Email validation accepts Cyrillic and rejects malformed addresses', () => {
  for (const email of ['алия@example.kz','почта@пример.рф','name.surname+tag@example.com','USER@EXAMPLE.KZ']) assert.equal(validEmail(email),true,email);
  for (const email of ['', 'безсобаки', '@example.kz','a@','a@@example.kz','a@domain','a b@example.kz','a..b@example.kz','a@-domain.kz','a@domain-.kz','a@domain..kz','.a@example.kz','a.@example.kz']) assert.equal(validEmail(email),false,email);
  assert.equal(normalizeEmail(' АЛИЯ@EXAMPLE.KZ '),'алия@example.kz');
});
