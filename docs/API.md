# JUDGE API · v0.2.0

Базовый путь `/api`. JSON UTF-8. Пользовательские маршруты работают только с cookie `judge_session`. Изменяющие запросы требуют точный разрешённый `Origin`, `Content-Type: application/json` и `X-CSRF-Token` из bootstrap. Максимальный JSON body — 32 KiB. Content-Type проверяется сервером; `text/plain` не подходит.

## HTTP-маршруты

| Метод | Путь | Вход / результат |
|---|---|---|
| GET | `/api/health` | версия, `sqlite`, `local-pilot` |
| GET | `/api/bootstrap` | создаёт гостевую сессию; csrf, user, ai, cases, stats, platforms |
| POST | `/api/cases` | `claim`, необязательный `draft`; возвращает detail, HTTP 201 |
| GET | `/api/cases` | дела и счётчики текущего владельца |
| GET | `/api/analytics` | воронка по уникальным делам, недельная социальная статистика и 14-дневная активность; только текущий владелец |
| GET | `/api/cases/:id` | state, events, findings, dialogue, invites, audit, comparison |
| GET | `/api/cases/:id/audit` | `{consistent,eventsChecked,storedVersion,replayedVersion}`; только владелец |
| GET | `/api/cases/:id/brief` | структурированный JSON `{brief,...comparison}`; только если phase=`verdict` |
| DELETE | `/api/cases/:id` | удаляет своё дело, события и зависимые записи; JSON `{}` |
| POST | `/api/cases/:id/action` | command envelope + `action: narrow|evidence|reframe` |
| POST | `/api/cases/:id/brief` | envelope + `draft` |
| POST | `/api/cases/:id/verdict` | envelope + `claim`, `acknowledged:true` |
| POST | `/api/cases/:id/reopen` | envelope; владелец открывает пересмотр с отзывом приглашений старого вердикта |
| GET | `/api/cases/:id/export` | TXT-бриф; до выбора финальной фразы — 409 |
| POST | `/api/cases/:id/invite` | envelope + `consent:true` |
| POST | `/api/cases/:id/revoke` | envelope + `inviteId` |
| GET | `/api/witness/:token` | ограниченный снимок приглашения; нужна гостевая cookie после bootstrap |
| POST | `/api/witness/:token` | `text`; одна отправка, повтор — 410 |
| POST | `/api/cases/:id/defend` | envelope + `text` для ответа на возражение |
| POST | `/api/cases/:id/handoff` | envelope + `platformId`, `consent` для внешней передачи |
| POST | `/api/cases/:id/ai` | envelope + `consent:true`; только при настройке модели |
| POST | `/api/auth/register` | `email`, `password`, `accepted:true`; ротация cookie |
| POST | `/api/auth/login` | `email`, `password`; ротация cookie |
| POST | `/api/auth/logout` | `{}`; текущая сессия отзывается |
| GET | `/api/privacy/export` | JSON своих дел и событий без секретов |
| POST | `/api/privacy/delete` | `confirm: DELETE`; удаление активных данных и сессий владельца |
| POST | `/api/integrations/redeem` | отдельная Bearer-авторизация платформы; token |
| POST | `/api/integrations/events` | Bearer-авторизация; согласованный внешний event |

API приложения не предназначен для cross-origin browser-вызовов с произвольных сайтов. Server-to-server integration routes не используют пользовательскую cookie, Origin или CSRF: вместо этого обязательна отдельная авторизация платформы.

## Конверт команды

```json
{
  "commandId": "b464c2c4-8375-4ec3-8b79-70406475c197",
  "expectedVersion": 1,
  "action": "narrow"
}
```

commandId — 8–100 символов `[A-Za-z0-9_-]`; генерируйте новый UUID для нового намерения. Повтор того же намерения использует прежний commandId. Сфера уникальности — дело.

`expectedVersion` — последняя версия из detail. Изменяющий ответ возвращает detail с новой версией. При 409 `VERSION_CONFLICT` загрузите актуальное дело, покажите изменение пользователю и только после согласования отправляйте новое намерение. Не переписывайте expectedVersion автоматически ради обхода конфликта.

Идемпотентность основных команд предотвращает повторные события, но не хранит идентичный первоначальному ответ с открытым invite token: токены приглашений сохраняются только как hash. После потерянного сетевого ответа получите список приглашений, отзовите неизвестное и создайте новое. Автоматический retry создания самого дела пока не реализован.

AI commandId резервируется перед внешним вызовом. Если команда уже выполняется или была неуспешно предпринята, возвращается 409 `AI_ALREADY_ATTEMPTED`; повтор выполненной команды возвращает текущее дело с `duplicate:true` без вызова модели. После сбоя сервера в момент внешнего запроса результат может быть потерян, но повторный платный вызов той же команды не запускается автоматически.

## Draft

```json
{
  "product": "Рабочий кабинет",
  "audience": "Независимые специалисты",
  "fact": "Храните заметки и списки задач в одном кабинете.",
  "problem": "Заметки теряются в разных приложениях?",
  "cta": "Посмотреть пример",
  "evidence": "Описание функции предоставлено владельцем продукта.",
  "source": "https://example.com/product"
}
```

`product`: 2–100; `audience`: 2–160; `fact`: 5–500; `problem`: 0–240; `cta`: 2–100; `evidence`: 0–1000; `source`: 0–500 символов. В ветке evidence описание основания должно содержать не менее 10 символов. Источник — пустая строка или HTTPS URL без встроенного логина/пароля. Сервер не открывает его.

## Бриф

Версия схемы: `judge-brief-1`. Поля: caseId, verdictId, product, audience, originalClaim, finalClaim, declaredFact, desiredAction, evidence, risks, disclaimer, rulesVersion.

`evidence.status` всегда `user_supplied_unverified`. `risks` — вопросы ограниченного анализатора, а не полный риск-профиль. Пустой risks не означает «реклама безопасна». Пользовательский текст остаётся недоверенным для любой получающей системы.

## Приглашение свидетеля

При создании ответ содержит `invite.id`, `invite.token`, `expiresAt`. Клиент строит hash-route:

```text
https://<host>/#/witness/<token>
```

Затем UI отправляет ограниченный API-запрос. Hash-route не передаётся с первоначальным HTTP GET страницы; запрос `/api/witness/:token` всё равно содержит секрет в пути, поэтому reverse-proxy не должен логировать такие URI. Встроенный сервер не ведёт журнал запросов.

TTL семь дней, максимум пять активных приглашений на дело. После отправки, отзыва или истечения — HTTP 410. Токен относится к версии приговора; новое решение не должно принимать старое возражение. Отправка возражения, запись reopened и отметка used_at атомарны.

## Подписанный deeplink: только после согласования сайта

Пример конфигурации — **не подключённый реальный сайт**:

```json
{
  "id": "A",
  "name": "Проверенное имя платформы",
  "mode": "deeplink",
  "verified": true,
  "url": "https://example.com/receive-judge",
  "credentialEnv": "PLATFORM_A_CREDENTIAL",
  "confirmedEvents": ["ad_created"]
}
```

`verified:true` выставляет оператор после проверки URL и контракта; это не автоматический аудит. Для режима необходимы HTTPS URL без userinfo, серверный credential получателя и HANDOFF_SECRET достаточной длины. Секреты не находятся в JSON-конфигурации.

JUDGE возвращает URL с `judge_token`, содержащим только `{v, id, platform, exp}` и HMAC-подпись. TTL передачи — один час. Принимающий сервер делает:

```http
POST /api/integrations/redeem
Authorization: Bearer <receiver credential>
Content-Type: application/json

{"platformId":"A","token":"<signed judge token>"}
```

Ответ: `{handoffId, brief}`. Передача одноразовая. Подпись, срок, platformId и факт предыдущего получения проверяются до выдачи.

После **настоящего** согласованного действия получающий сервер отправляет:

```http
POST /api/integrations/events
Authorization: Bearer <receiver credential>
Content-Type: application/json

{
  "platformId":"A",
  "handoffId":"<received id>",
  "eventId":"<stable receiver event id>",
  "action":"ad_created"
}
```

Только такой ответ создаёт `useful_action`. Тип должен находиться в confirmedEvents; передача должна быть ранее получена. Повтор eventId в рамках платформы возвращает `duplicate:true`. Не используйте новый eventId при транспортном повторе.

Сам внешний callback не доказывает качество рекламы или коммерческий результат. Копирование, клик, открытие страницы, регистрация и создание рекламы — разные события.

## Ошибки

```json
{"error":{"code":"VERSION_CONFLICT","message":"Дело изменилось в другой вкладке. Обновите страницу и повторите."}}
```

400 — формат/валидация/подтверждение. 401 — сессия или credential. 403 — Host/Origin/CSRF, неправильная платформа или контракт. 404 — объект не существует либо не принадлежит пользователю; доступность чужого id не раскрывается. 409 — версия/состояние/повторная операция. 410 — истёкший/отозванный/использованный token. 413 — большой body. 415 — Content-Type. 422 — отказ провайдера. 429 — ограничение запросов. 502 — ошибка/неполный ответ провайдера. 503 — функция не настроена.

## Что контракт НЕ включает

Платежи, фактическую регистрацию на семи сайтах, отправку email, OAuth/SSO, webhook подписи чужих API, восстановление пароля, production-ready schema migrations или Supabase endpoints. Их не следует вызывать на основании этого документа: маршрутов нет.
## Дополнения v0.2

`audit.consistent` проверяет, что актуальный JSON-снимок полностью соответствует результату `replay()` всех событий, упорядоченных по ID. Неподтверждённое несоответствие блокирует все дальнейшие команды для дела; это не криптографическая защита от администратора БД, который мог бы переписать и события, и снимок.

`GET /api/analytics` возвращает `{definition:'unique_cases_with_event',funnel,social,series,eventsTotal,disclaimer}`. Каждый `funnel[*].count` — число уникальных дел с соответствующим событием, `rate` — доля относительно всех открытых дел, а не подтверждённая конверсия пользователей или рекламных кампаний. `useful_action` появляется только от согласованной внешней платформы через авторизованный receipt.

`POST /api/cases/:id/reopen` допускается только в фазе `verdict`. Он добавляет событие `owner_reopen`, переводит дело в `reopened` и отзывает неиспользованные приглашения. Затем клиент вызывает стандартные `action → brief → verdict`. Предыдущий вердикт не удаляется из событий.

Бриф `{schemaVersion:'judge-brief-1'}` включает исходный и конечный текст, заявленный факт, действие, источник со статусом `user_supplied_unverified`, предупреждения и правила. Он не обещает успешную доставку рекламы.


## Новые контракты 0.3.0

`POST /api/cases/{caseId}/handoff-revoke` — отзываемая только до `redeemed_at` signed-передача. Требуется cookie, Origin, CSRF, `commandId`, `expectedVersion`, `handoffId`.

`GET /api/cases/{caseId}` теперь возвращает безопасную сводку `handoffs[]` с `verdict_id`, `revoked_at`, `redeemed_at`, `confirmed_actions` без подписанных токенов и секретов.

Signed redeem выдаёт 410 `REVOKED` при отзыве либо 410 `STALE_VERDICT` при несовпадении текущей версии. Duplicate receipt допускается лишь при совпадении исходного handoff/action; иначе 409 `EVENT_CONFLICT`.

Подробный протокол для внешних площадок: `docs/INTEGRATION-CONTRACT-RU.md`.

---

## Дополнения v0.4.0 (серверная реализация)

| Метод | Путь | Доступ / ответ |
|---|---|---|
| GET | `/api/ready` | структурная readiness SQLite, `deployment:pilot-only`, без раскрытия дел |
| GET | `/api/auth/sessions` | только подтверждённая локальная сессия зарегистрированного пользователя; список `{id,device,createdAt,lastSeenAt,expiresAt,current}` |
| POST | `/api/auth/sessions/revoke` | `{id}` (20 hex-символов префикса SHA256 session token), только собственный сеанс; текущий сеанс очищает cookie |
| POST | `/api/auth/password` | `{currentPassword,newPassword}`; проверка пароля, запись нового scrypt, удаление всех прежних сессий, новый HttpOnly cookie и `csrf` |
| POST | `/api/integrations/redeem` | `{platformId,token,requestId?}`; при наличии стабильного `requestId` допускается идентичный повтор ответа в течение 5 минут |

`GET /api/auth/sessions`, `POST /api/auth/sessions/revoke`, `POST /api/auth/password` работают только с user cookie + CSRF/Origin на POST. Назначить себе чужой сеанс через внешний ID нельзя: сервер ограничивает запрос `owner_id` из проверенной cookie. Пароль должен быть 12–128 символов. Email пока не подтверждается, режим — закрытый пилот.

Получение брифа при повторном `redeem`: требует **те же** авторизованные данные принимающего сайта, тот же signed token, тот же `requestId` и неизменный текущий вердикт. Ограничение времени 5 минут после первого успешного приёма и 1 час TTL исходного токена. При старом/изменённом ключе JUDGE возвращает `409 REDEEMED`.

`README_RU.md` и `docs/RECEIVER-INTEGRATION-RU.md` имеют приоритет для v0.4 над историческими примерами предыдущих версий в этом документе.


---

## JUDGE 0.5.0: Evidence Room — слепое сравнение текстов

Все запросы выполняются к тому же локальному серверу. `POST` требует cookie, заголовки `Origin`, `X-CSRF-Token` и JSON body. Создание/выдача/закрытие доступны только владельцу конкретного дела; все управляющие команды версионированы. `GET` публичного опроса также требует гостевой session-cookie, которую браузер получает через `/api/bootstrap`, но **регистрация не нужна**.

### Создать опрос

`POST /api/cases/:caseId/comparison-start`

```json
{"commandId":"unique-id-at-least-8","expectedVersion":5,"consent":true}
```

Только `phase=verdict`, `claim` должен отличаться от `finalClaim`. Сервер создаёт неизменяемый снимок **двух** фраз и вопроса о понятности, лимит — 3 теста на вердикт. В ответе `comparisonId`, текущее состояние дела, `comparisons` и события. TTL опроса — 14 суток.

### Выпустить одноразовую ссылку

`POST /api/cases/:caseId/comparison-invite`

```json
{"commandId":"unique-id-at-least-8","expectedVersion":6,"comparisonId":"UUID"}
```

Ответ содержит `comparisonInvite.token`, `expiresAt` (только один раз). Ссылка участника в hash-route `https://your-app/#/compare/<token>`. Сервер хранит только SHA-256 токена. Максимум 30 ссылок, каждая действует до 7 дней и не дольше TTL теста. Порядок двух текстов балансируется 50/50 при чётном количестве выдач.

### Публичная карточка и голос

`GET /api/compare/:token` — `{question,first,second,expiresAt,disclosure}`. Нет внутренних данных, промежуточных подсчётов, пометок исходной/новой версии или персональных сведений автора.

`POST /api/compare/:token`:

```json
{"choice":"first","note":"Более конкретно объясняет пользу","accepted":true}
```

`choice` = `first` / `second` / `neither`, `note` от 0 до 500 символов. Сервер нормализует выбор в `a` / `b` / `neither` независимо от перестановки. Автор не может голосовать из своей сессии. Второй голос по той же ссылке отклоняется HTTP 410. Нет защиты от накрутки голосов через самостоятельное создание множества гостевых сессий — **не используйте опрос для статистически значимых выводов или автоматического ранжирования эффективности**.

### Получить агрегаты и закрыть

`GET /api/cases/:caseId/comparisons` — данные только владельца: число голосов `a/b/neither`, количество ссылок, комментарии, статус `open/closed/invalidated/expired`.

`POST /api/cases/:caseId/comparison-close`:

```json
{"commandId":"unique-id-at-least-8","expectedVersion":11,"comparisonId":"UUID"}
```

Закрытие запрещает новые ответы. При `owner_reopen` или `witness_objection` активные опросы автоматически получают `status=invalidated`, а событие `comparison_invalidated` добавляется в журнал дела. Уже собранные результаты остаются в отчёте владельца.

### События дела

- `comparison_started` — тест создан с текущим `verdictId`.
- `comparison_link_issued` — индивидуальная ссылка выдана, открытый токен не сохраняется.
- `comparison_voted` — действительный голос получен (без персональных данных).
- `comparison_closed` — владелец закрыл опрос.
- `comparison_invalidated` — вердикт пересматривается и новые ответы запрещены.

Порядок и идентификаторы всех событий можно восстановить из SQLite; `/api/privacy/export` содержит свои опросы и комментарии, но не токены или их хэши. Не путать `comparison_voted` с `useful_action`: это **не** рекламная конверсия.

---

## JUDGE 0.10.0 — новые API пяти волн

Все ниже перечисленные `POST` требуют активной серверной сессии, проверки `Origin` и заголовка `X-CSRF-Token`, соответствующего значению `/api/bootstrap`. Корпоративный доступ требует **зарегистрированного** локального аккаунта. JSON-ошибки возвращают доменный код (`ACCOUNT_REQUIRED`, `NOT_FOUND`, `FORBIDDEN`, `STATE`, `EXPIRED`, `STALE_VERDICT` и др.). Сведения чужих пользователей не возвращаются.

### WAVE 1 / Workspaces

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/workspaces` | Все пространства текущего участника |
| POST | `/api/workspaces` | `{ "name": "Creative Strategy Council" }`; создать с ролью owner |
| GET | `/api/workspaces/{workspaceId}` | Участники, опубликованные дела, замечания, события |
| POST | `/api/workspaces/{workspaceId}/invite` | `{ "role": "reviewer" \| "viewer" }`; вернуть одноразовый токен |
| GET | `/api/workspaces/invitation/{token}` | Ограниченный просмотр команды и роли без раскрытия дел |
| POST | `/api/workspaces/invitation/{token}` | Принять приглашение авторизованным аккаунтом |
| POST | `/api/workspaces/{workspaceId}/share` | `{ "caseId": "<id>" }` только автором собственного дела |
| POST | `/api/workspaces/{workspaceId}/unshare` | Убрать публикацию из комнаты |
| POST | `/api/workspaces/{workspaceId}/review` | `{ "caseId": "<id>", "comment": "<text>" }` редактором |
| POST | `/api/workspaces/{workspaceId}/remove-member` | `{ "memberId": "<id>" }`; только owner |
| POST | `/api/workspaces/{workspaceId}/delete` | Удалить пространство; авторские дела не удаляются |

**Правило доступа:** `viewer` только читает; `reviewer` комментирует и публикует *своё* дело; `owner` управляет составом. Даже после публикации чужой вердикт нельзя изменить через Workspace API.

### WAVE 2 / Research

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/research` | Исследования в принадлежащих пользователю делах |
| POST | `/api/research` | `{ "caseId", "comparisonId", "hypothesis": "...", "targetResponses": 8 }`; гипотеза до сбора ответов |
| GET | `/api/research/{studyId}` | Действительный count голосов Evidence Room и условные интервалы |
| POST | `/api/research/{studyId}/conclude` | `{ "decision":"inconclusive" \| "iterate" \| "retain", "note":"..." }`; однократно |
| GET | `/api/research/export.csv` | CSV результатов только собственного аккаунта, с нейтрализацией CSV formula injection |

**Пример статистики:** `sample={total,a,b,neither,decisive,remaining,targetReached}`. Если `decisive=0`, статистические интервалы NULL. Не выдавайте результат за A/B-тест в рекламной сети.

### WAVE 4 / Partner conformance

Не создаёт новых публичных методов, но автоматически проверяет действующие `/api/integrations/redeem` и `/api/integrations/events` и контракт SDK `integrations/receiver-sdk.mjs`. Внешние URL A–G отсутствуют. Для каждого интеграционного действия требуется отдельный согласованный auth-контракт и подтверждение события.

### WAVE 5 / Operations

Ниже — **локальные команды оператора**, не открытые HTTP-маршруты:

```bash
npm run verify
npm run ops:retention
npm run ops:retention:apply
npm run integrations:conformance
npm run integrations:audit
```

Права администратора, секреты и доступ к SQLite остаются только у серверного оператора. В текущей версии нет централизованной admin-панели организации, production auth и RLS PostgreSQL.


## Waves 11-15 (v0.20.0)

Refer to `docs/WAVES-11-15-IMPLEMENTATION.md` for the complete table of operations and trust boundaries. New session-bound operations are under `/api/ops/workspaces/:wid/brands` and `/api/ops/campaigns/:cid/{brand,targets,audit,dispatch,dispatch-revoke,observation,observation-retract}`. Only `GET` operations omit the CSRF header. Partner-only POST routes `/api/integrations/release-redeem` and `/api/integrations/release-events` instead require per-platform bearer credentials and must not be called from the browser.

---

## WAVE 21–25 · JUDGE 0.30.0 API

API endpoints below are server-owned: changing state requires an existing session, same-origin request and CSRF. UUID resource identifiers are checked against tenant membership and campaign ownership. All errors use the existing `{"error":{"code":"...","message":"..."}}` shape.

| Method | Endpoint | Function and authorization |
|---|---|---|
| GET | `/api/auth/identity` | Registered account's verification status and mail availability (no token) |
| POST | `/api/auth/verify/request` | Issue hashed one-use email verification challenge; fails closed if no mail transport |
| POST | `/api/auth/verify/confirm` | Confirm one-use code for the session's account |
| POST | `/api/auth/recovery/request` | Generic email recovery response that does not identify existing accounts |
| POST | `/api/auth/recovery/confirm` | Consume code, replace password and invalidate previous sessions |
| GET | `/api/revisions/campaigns/:campaignId/:releaseId` | Diff current revision vs immutable historical release; team member |
| POST | `/api/revisions/campaigns/:campaignId/:releaseId/restore` | Body `{expectedRevision,acknowledged:true}`; editor, restores only a **new draft** |
| POST | `/api/imports/campaigns/:id/preview` | Body `{releaseId,sourceName,csv}`; read-only validation |
| POST | `/api/imports/campaigns/:id/commit` | Same body plus `{digest,expectedRevision,acknowledged:true}`; produces manual-source batch |
| GET | `/api/imports/campaigns/:id` | Lists imported batches visible to permitted team members |
| POST | `/api/delivery/campaigns/:id/queue` | Body `{dispatchId}`; approved release + configured API partner + governance constraints |
| POST | `/api/delivery/campaigns/:id/attempt/:queueId` | Owner-triggered authorized delivery attempt; no browser-held keys |
| GET | `/api/delivery/campaigns/:id` | Status of outbox tasks, without secret tokens |
| GET | `/api/ops/workspaces/:workspaceId` | Tenant-scoped campaign blockers and pending deliveries (NOT full global readiness) |

**Receiver protocol**: POST an envelope with `schema=adverse-release-push-1`, `dispatchId`, `releaseId`, `sha256`, and full immutable `package`. Request headers include `X-ADVERSE-Idempotency-Key` (`judge-UUID`), `X-ADVERSE-Body-SHA256`, `X-ADVERSE-Signature` (`v1=` HMAC-SHA256 of `key + "\n" + bodyDigest`). Receiver must durably remember the key and digest; respond HTTP 200 or 202 with `{ "accepted": true, "idempotencyKey": "same key" }`. This acknowledges receipt only, **not publication**. A separate authenticated existing receipt endpoint handles supported business events once the real partner reports them.

**Safety**: never pass `deliveryKeyEnv` secret to frontend; never infer `useful_action` from delivery ACK. A wrong/stale dispatch, revoked source permission, pause or missing real partner config blocks delivery. Pending retries are processed by a one-shot operator command (`npm run delivery:once`), not an autonomous scheduler in this release.
