# tests/unit/

Vitest. Unidades puras (sem rede/DB).

## Foco

- `lib/api/wrappers.test.ts` — formato de response, status codes, X-Request-Id
- `lib/api/errors.test.ts` — códigos não duplicados / não renomeados
- `lib/env.test.ts` — schema Zod aceita combos válidos, rejeita inválidos
- `lib/waha/throttle.test.ts` — rate limit anti-banimento
- `lib/waha/stop-detection.test.ts` — regex STOP/PARAR/SAIR/UNSUBSCRIBE
- `lib/waha/signature.test.ts` — HMAC SHA512 com `timingSafeEqual`
- `lib/api/pagination.test.ts` — encode/decode cursor + tampering rejected

## Comandos

```bash
npm run test:unit
npm run test:unit -- --watch
```
