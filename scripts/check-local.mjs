import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

config({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)) })
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Esta verificação exige um banco local de desenvolvimento.')
const db = new PrismaClient()
const createdUsers = []
const createdCompanies = []
const base = 'http://localhost:5173/api'
async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { Origin: 'http://localhost:5173' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie()[0]?.split(';')[0] }
}
async function localUser(name, email, password) {
  // Isolated fixtures avoid dispatching mail to synthetic addresses. Signup and
  // email verification are exercised through the authentication test suite.
  const user = await db.user.create({ data: { name, email, passwordHash: await argon2.hash(password), emailVerifiedAt: new Date() } })
  createdUsers.push(user.id)
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), authVersion: 0, expiresAt: new Date(Date.now() + 3600_000) } })
  return { status: 200, body: { user: { id: user.id, name, email } }, cookie: `omnimark_session=${token}` }
}
try {
  assert.equal((await fetch('http://localhost:5173/')).status, 200)
  assert.equal((await request('/auth/me')).status, 401)
  const password = randomUUID() + '!'
  const email = `smoke-${randomUUID()}@example.invalid`
  const owner = await localUser('Verificação temporária', email, password)
  assert.equal(owner.status, 200)
  assert.ok(owner.cookie)
  assert.equal((await request('/auth/me', { cookie: owner.cookie })).body.user.id, owner.body.user.id)
  const company = await request('/companies', { method: 'POST', cookie: owner.cookie, body: { name: 'Empresa temporária de verificação', legalName: 'Razão social temporária', cnpj: '12345678000190' } })
  if (company.body.id) createdCompanies.push(company.body.id)
  assert.equal(company.status, 201)
  assert.equal(company.body.legalName, 'Razão social temporária')
  const updatedCompany = await request(`/companies/${company.body.id}`, { method: 'PATCH', cookie: owner.cookie, body: { name: 'Empresa editada', legalName: 'Razão social editada', cnpj: null } })
  assert.equal(updatedCompany.status, 200)
  assert.equal(updatedCompany.body.cnpj, null)
  assert.equal(updatedCompany.body.legalName, 'Razão social editada')
  assert.equal((await request('/auth/me', { method: 'PATCH', cookie: owner.cookie, body: { name: 'Nome atualizado' } })).status, 200)
  assert.equal((await request('/auth/me', { cookie: owner.cookie })).body.user.name, 'Nome atualizado')
  assert.deepEqual((await request(`/companies/${company.body.id}/accounts`, { cookie: owner.cookie })).body, [])
  const outsider = await localUser('Outro usuário temporário', `smoke-${randomUUID()}@example.invalid`, password)
  assert.equal(outsider.status, 200)
  for (const resource of ['accounts', 'dashboard']) {
    assert.equal((await request(`/companies/${company.body.id}/${resource}`, { cookie: outsider.cookie })).status, 404)
  }
  assert.equal((await request(`/companies/${company.body.id}`, { method: 'PATCH', cookie: outsider.cookie, body: { name: 'Alteração indevida' } })).status, 404)
  await db.companyMember.create({ data: { userId: outsider.body.user.id, companyId: company.body.id, role: 'VIEWER' } })
  assert.equal((await request(`/companies/${company.body.id}`, { method: 'PATCH', cookie: outsider.cookie, body: { name: 'Alteração indevida' } })).status, 403)
  assert.equal((await request('/auth/logout', { method: 'POST', cookie: owner.cookie })).status, 200)
  assert.equal((await request('/auth/me', { cookie: owner.cookie })).status, 401)
  assert.equal((await request('/auth/login', { method: 'POST', body: { email, password: randomUUID() } })).status, 401)
  const login = await request('/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  assert.ok((await request('/companies', { cookie: login.cookie })).body.some(item => item.id === company.body.id && item.name === 'Empresa editada' && item.legalName === 'Razão social editada'))
  const secondSession = await request('/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(secondSession.status, 200)
  const newPassword = randomUUID() + '!'
  assert.equal((await request('/auth/password', { method: 'PATCH', cookie: login.cookie, body: { currentPassword: 'senha-incorreta', password: newPassword } })).status, 400)
  assert.equal((await request('/auth/password', { method: 'PATCH', cookie: login.cookie, body: { currentPassword: password, password: newPassword } })).status, 200)
  assert.equal((await request('/auth/me', { cookie: secondSession.cookie })).status, 401)
  assert.equal((await request('/auth/me', { cookie: login.cookie })).status, 200)
  assert.equal((await request('/auth/login', { method: 'POST', body: { email, password } })).status, 401)
  assert.equal((await request('/auth/login', { method: 'POST', body: { email, password: newPassword } })).status, 200)
  console.log('OK: página, cadastro, sessão, criação/edição de empresa, perfil, autorização OWNER/VIEWER, logout, alteração de senha e revogação das outras sessões.')
} finally {
  try {
    await db.company.deleteMany({ where: { id: { in: createdCompanies } } })
    await db.user.deleteMany({ where: { id: { in: createdUsers } } })
    console.log('Registros temporários desta verificação removidos.')
  } finally {
    await db.$disconnect()
  }
}
