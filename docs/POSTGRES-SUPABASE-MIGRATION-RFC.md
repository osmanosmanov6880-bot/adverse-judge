# RFC: будущая миграция JUDGE с SQLite на PostgreSQL / Supabase

Статус: **архитектурный проект, НЕ внедрено и НЕ применено к аккаунту пользователя**. Текущий релиз v0.4 хранит дела в SQLite. В этом релизе нет готового PostgreSQL runtime, RLS-политик, общей SSO или облачной миграции данных.

## Задача

Разнести `users`/`sessions`/`cases`/`events`/`commands`/`invites`/`handoffs`/`integration_receipts`/`auth_failures`/`ai_reservations` в новую схему без раскрытия приватных материалов через Data API. Самым безопасным вариантом для сервера будет приватная схема `judge_internal` и работа только через backend API; доступ из браузера к таблицам не требуется.

## Будущая структура

- `judge_internal.cases` с `owner_id uuid`, `state jsonb`, `version integer`, created/updated timestamps.
- `judge_internal.events` append-only ledger, `case_id` с FK, server-assigned ordering; транзакционный replay.
- `judge_internal.handoffs` с `verdict_id`, `redeem_request_hash`, `revoked_at`, `redeemed_at`, TTL.
- `judge_internal.integration_receipts` уникальный `(platform_id,event_id)`, привязка к действительному `handoff_id`.
- `judge_internal.invites` только digest токена, never raw.
- Публичный Data API не должен выставлять `judge_internal.*`. Если будут таблицы в `public`, для **каждой** обязательны grants + RLS; политика владельца — `USING ((select auth.uid()) = owner_id)`, а для update — ещё и `WITH CHECK`.

## Миграция без потери данных

1. Инвентаризация идентификаторов и guest→verified account linking; иначе осиротеют данные.
2. Параллельный экспорт и сравнение event ledger и state перед переносом. Шифрованная резервная копия.
3. Развернуть тестовую базу и независимый replay oracle, сверить counts, hashes, версии.
4. Тесты изоляции `ownerA≠ownerB`, wrong-auth, JWT expiry, session revoke, RLS grants. Проверить ошибки на `SECURITY DEFINER`, views и логах.
5. Сначала shadow-read/canary, затем атомарное переключение после заморозки записи, с планом отката по базе.

Для реализации через Supabase надо проверять текущие docs/CLI, grants/Data API settings и состояние конкретного Supabase проекта. В документации Supabase указано, что `auth.getSession()` без верификации сервером не является основанием для authorization; предпочтительны проверенные claims / user. Нельзя передавать `service_role`/secret в браузер.

**Блокер:** нет точного проекта и подтверждённого источника авторизации для семи работающих сайтов. Реальный перенос не начинать до выбора целевой базы и проверки данных.
