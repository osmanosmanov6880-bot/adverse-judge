#!/usr/bin/env python3
from pathlib import Path
from PIL import Image
import subprocess, json, hashlib, textwrap
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs';DOC.mkdir(exist_ok=True)
scenes=json.loads(subprocess.check_output(['node','-e',f"process.stdout.write(JSON.stringify(require('{ROOT / 'src/data.js'}').scenes))"],text=True))
source_size={'city':(595,370),'skyline':(700,411),'tribunal-light':(350,290),'human':(220,140),'aftermath':(515,420),'vantage':(175,203)}
frames={}
for p in sorted((ROOT/'assets').glob('*.webp')):
 with Image.open(p) as img:
  name=p.stem.removesuffix('-mobile')
  frames[p.name]={'filename':'assets/'+p.name,'asset_key':name,'output_resolution':list(img.size),'format':'WebP','bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'original_crop_resolution':list(source_size[name]) if name in source_size else [1600,900], 'source_type':'crop_from_generated_design_board' if name in source_size else 'original_procedural_illustration', 'resampling_used':bool(name in source_size or p.stem.endswith('-mobile')), 'claimed_8k':False, 'quality_note':'LANCZOS-upsample from a small composition crop; use as concept placeholder, not genuine 8K' if name in source_size else 'Original procedural bitmap at 1600x900; mobile image derived by crop and resize'}
manifest={'title':'ADVERSE JUDGE — Cinematic Interactive Experience','version':'1.0.0','source_materials':'AI-generated design-board crops and original algorithmically rendered sci-fi environments; no licensed third-party audio or cinematic video','quality_policy':'Honest source dimensions; do not describe these as native 4K/8K or photorealistic movie footage','display':'responsive cover; desktop up to 1440x900 from files; mobile 720x1080; browser can rescale','fallback':'CSS gradients if a media asset fails','assets':list(frames.values())}
(DOC/'ASSET_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# All mandatory columns from the brief, and every scene has a concrete action/condition/transition.
lines=['# Режиссёрская раскадровка — ADVERSE JUDGE','',
'**Жанр:** интерактивный судебный sci-fi-триллер об ответственном рекламном обещании. **Цель:** пройти расследование, переписать утверждение и экспортировать структурированный черновик. **Зрители:** основатели, маркетологи, агентства, потенциальные партнёры. **Прохождение:** примерно 3–5 минут без ограничения времени выбора.','',
'**Сюжет:** Пролог → интрига → исследование → голоса Лекса и Авроры → архив → выбор → последствия → Свидетель 404 → разворот перспективы → личный вердикт → финал. Ключевой поворот — главным свидетелем оказывается сам зритель.','',
'Легенда: «план» — размер кадра, «камера» — программный CSS-приём; аудио — синтезированный WebAudio-тон и тишина, не готовая музыка. UI-текст наложен DOM, а не встроен в изображение.','',
'| № и сцена | Задача и эмоция | Композиция, объект, план | Камера и объекты | Свет и атмосфера | Звук | Длина | Текст / действие зрителя | Ветки / переход | Исходные файлы |',
'|---|---|---|---|---|---|---|---|---|---|']
for s in scenes:
 branches='; '.join(f"{c['label']} → {c.get('next',c.get('action','modal'))}" for c in s['choices'])
 art='assets/'+s['art']+'.webp (desktop); assets/'+s['art']+'-mobile.webp'
 visual=s.get('visual','')
 obj='Главный объект: '+s['title']+'; '+visual
 movement='CSS '+s['camera']+'; движение объектов: '+s.get('atmosphere','минимум')
 light=s.get('lighting','')+'; '+s.get('atmosphere','')
 audio=f"ambient {s['ambience']} / cue {s['cue']}"+('; тишина важнее подложки' if s['ambience']=='quiet' else '')
 st=s['headline'].replace('\n',' / ') + '; ' + ('форма '+s['form'] if s.get('form') else 'выбор')
 emotional={'scene_001':'Интрига, медленный вход','scene_002':'Благоговение и сомнение','scene_003':'Масштаб и любопытство','scene_004':'Риск, личная ответственность','scene_005':'Напряжение, строгость','scene_006':'Тепло и сочувствие','scene_007':'Исследование и тревога','scene_008':'Решимость','scene_009':'Осознание выбора','scene_010':'Сопереживание','scene_011':'Неуютная буквальность','scene_012':'Шок, тишина','scene_013':'Контроль, ясность','scene_014':'Кульминация и облегчение','scene_015':'Спокойствие и надежда'}[s['id']]
 cells=[s['number']+' '+s['title'],s['chapter']+' — '+emotional,obj,'Тип плана: общий/средний по необходимости; '+movement,light,audio,str(s['duration'])+' с (не таймер)',st,branches,art]
 cells=[c.replace('|','/').replace('\n',' / ') for c in cells]
 lines.append('| '+' | '.join(cells)+' |')
lines.extend(['','## Ветки и последствия','','- Пролог можно пропустить без потери доступа к первому рекламному делу.','- После предъявления обещания зритель может начать с Лекса, Авроры или архива.','- В сцене 7 зритель явно отмечает наличие источника либо отсутствие доказательств; наличие описания не делает источник проверенным.','- В сцене 8 выбирается одна из трёх стратегий: ясность / проверка оснований / человеческий смысл. Выбор записывается в историю.','- Свидетель 404 задаёт альтернативное прочтение обещания.','- В финале скачивается **черновик** (`adverse.cinematic-brief.v1`) или копируется новая формулировка.','- При возврате к стратегии ранее зафиксированный вердикт аннулируется.','- Три скрытых протокола находятся на сценах 2, 7 и 11 и доступны с клавиатуры.','','## Монтаж','', 'Скорость между изображениями 0,9–1,1 с, паузы у Криптографической печати и Свидетеля до выбора зрителя; ни одна сцена не продвигается автоматически. Субтитры передаются строкой сцены внизу экрана.'] )
(DOC/'STORYBOARD_RU.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

# Real image-generation prompts with concrete compositions / negative space; one per scene.
orient={'skyline':'aerial wide skyline, a giant luminous ring above elevated city bridges, one distant observer silhouette','city':'dense futuristic city at twilight, foreground lone black-coated investigator','hall':'monumental tribunal sanctuary with asymmetric stone pillars and warm central doorway','chamber':'enormous octagonal interrogation chamber, isolated glass evidence monolith','archive':'towering labyrinth of evidence shelves and cyan archival holograms','tribunal-light':'faceted statue of justice rendered in obsidian glass, rim lighting','human':'portrait of the witness behind dark tinted glass, natural complexion and wary expression','aftermath':'rainy elevated city boulevard with reflective advertising surfaces and anonymous passersby','verdict':'circular gilded judicial chamber with immense illuminated ring, no judge present','vantage':'high viewing platform looking down over a sprawling city'}
shot=['24 mm very wide establishing shot','28 mm low-angle establishing shot','32 mm deep-focus interior shot','50 mm product-evidence medium shot','70 mm directional side light, serious medium shot','75 mm intimate close-up','28 mm atmospheric long axial perspective','35 mm symmetrical tableau','40 mm elevated bridge medium wide','28 mm high viewpoint','85 mm close-up human portrait','35 mm observer-perspective reverse shot','50 mm quiet medium shot','40 mm massive circular dome','24 mm natural dawn wide shot']
text=['# Промпты для самостоятельной генерации кинематографических кадров','',
'Каждый промпт — **для отдельного чистого фонового кадра**, а не для интерфейсного мокапа. Запросить 16:9, без текста, логотипов и UI внутри изображения. Выходные файлы обозначены как `assets/scene_###.webp` и могут заменить переиспользуемые ключевые материалы только через поле `art` в `src/data.js` (не меняя граф сюжета).','',
'## Неподвижные правила преемственности','',
'**Мир:** один футуристический Трибунал над городом, ночной влажный камень, brushed brass, smoke glass, ледяной cyan и редкие тёплые контровые лучи. Нет случайных платьев, дворцов или изменения архитектуры. **Повторяющийся герой:** мужчина-наблюдатель 30–40 лет, тёмное прямое пальто, вид преимущественно со спины или в трёхчетвертном ракурсе; его лицо не обязано появляться. **Лекс:** голос/символ красного анализа, без физического лица. **Аврора:** золотой свет/голос защиты, без случайно меняющегося лица. **Свидетель 404:** один нейтральный человеческий портрет за стеклом — до получения консистентной отдельной референс-модели не показывать его в нескольких новых ракурсах.','']
for i,s in enumerate(scenes):
 prompt=(f"Cinematic still, premium grounded science fiction, frame {s['number']} {s['title']}. "
 f"Main narrative subject and space: {orient[s['art']]}. Specific narrative beat: {s['visual']}. "
 f"Camera: {shot[i]}, camera centered approximately 1.6 meters above floor unless an aerial/low-angle scene; "
 f"foreground includes out-of-focus architectural occlusion; medium-ground has one meaningful subject, background with at least 3 distinct depth layers. "
 f"Lighting: {s['lighting']}. Physical materials: wet black limestone, tarnished brass, smoky glass, subtly scratched steel, low-density volumetric dust. "
 f"Atmosphere: {s['atmosphere']}. Grade: deep neutral blue-black, restrained bronze highlights, occasional cold cyan reflections and red only when conflict demands it. "
 f"Leave the left 45 percent of image dark and unoccupied for live HTML titles, never place face or crucial evidence in that left area. "
 f"Mood: {s['chapter']} and {s['title']} narrative. Image aspect ratio 16:9, crisp native 1920x1080 target if generator offers that resolution, "
 f"no fictional lettering, no signage, no typography, no logos, no built-in buttons, no watermark, no repeated figures, no collage, no infographic, "
 f"no purple-neon overload, no excessive lens flares, no impossible interpenetration of objects, no blurry main subject.")
 text += [f"## {s['id']} — {s['title']}",f"- **ID:** {s['id']}; **целевой файл:** `assets/{s['id']}.webp`; **заменяемый сейчас арт:** `{s['art']}.webp`; **движение:** {s['camera']}; **слои (если появятся исходные маски):** передний план / главный объект / архитектура / дальний фон; **минимальный ориентир:** 1920×1080 native; **мобильный:** 720×1080 кадрирование/отдельная генерация.", '','```text',prompt,'```','']
text += ['## Реальный статус','', 'В текущей сборке использованы 10 уникальных основных фоновых композиций (6 фрагментов AI-макетов и 4 самостоятельных процедурных пространства), каждая в двух форматах. Для 15 сцен есть отдельные промпты на улучшенные будущие кадры. Не выдавайте обработанные фрагменты маленьких AI-макетов за родные 8K изображения.']
(DOC/'IMAGE_PROMPTS_RU.md').write_text('\n'.join(text)+'\n',encoding='utf-8')

(DOC/'STYLE_BIBLE_RU.md').write_text('''# ADVERSE JUDGE — визуальная и звуковая библия

## Миссия
Дорогое кинематографическое впечатление через хорошую режиссуру, монтаж, сильные кадры и точное программное движение. Не выдавать редакторскую эвристику за фактологическую или юридическую экспертизу.

## Палитра
- Обсидиан `#080e19` — основа мира, низкая яркость фона.
- Шампань `#dfc49b` — доверие, кульминация, награда.
- Сдержанный холодный циан `#8bd3d4` — анализ, архив.
- Оттенок сомнения `#df827e` — обвинение, редакторские риски.
- Текст `#f5f3ec` и вторичный `#b7beca` — стабильный контраст.

## Свет, материалы, пространство
Базовая связность: влажный чёрный камень, копоть металла, дымчатое стекло, локальный объёмный свет. В публичном городе — закат/рассвет; в архиве — холодная телеметрия; в комнате выбора — почти тишина. Скрывать интерфейс за пышными эффектами запрещено.

## Оптика и типографика
Общие планы 24–35 mm, судебные элементы 40–50 mm, человеческое лицо 75–85 mm. Заголовок — контрастная антиква Georgia или аналог, всё остальное — нейтральный системный sans-serif. Никогда не запекать сюжетный текст в картинки. Левое пространство отдаётся титрам; объекты появляются преимущественно справа и в центре.

## Движение
Slow push, slow pull, pan, tilt и drift выполняются CSS трансформациями всего подготовленного кадра; нет вырезания персонажа без маски. Режимы: CINEMATIC (полные CSS-дрейф и частицы), BALANCED (ограниченная анимация), LITE (статичные кадры). Системное `prefers-reduced-motion` отключает необязательные движения.

## Звуковой дизайн
Звук выключен до осознанного клика пользователя. Синтезируется WebAudio: два низкочастотных осциллятора, фильтр низких частот, gain-envelope на событиях. Никаких внешних MP3/OGG и музыкальных лицензий не требуется. При отсутствии WebAudio история остаётся работоспособной. Контроль громкости находится в настройках.

## Персонажи
Лекс — **программная роль обвинения**, красная подсветка и прямые утверждения без «одушевления» модели. Аврора — **программная роль защиты**, тёплый свет и человеческая польза без неподтверждённых данных. Свидетель 404 — **программная роль буквального прочтения**, холодный крупный план. Никакое из этих изображений не подтверждает наличия реального человека, общения с ИИ или юридического заключения.

## Запреты
Нет постоянного видеопотока, самопроизвольного громкого звука, бесконечных анимационных частиц, фальшивых кнопок интеграции A–G, 8K-ярлыков на апскейленных ресурсах, мнимой статистики рекламной эффективности.
''',encoding='utf-8')

(DOC/'INTERACTION_GRAPH.md').write_text('''# Граф состояний

```mermaid
flowchart TD
 S01[01 Сигнал] --> S02[02 Врата]
 S01 -->|Пропустить пролог| S04[04 Дело]
 S02 --> S03[03 Зал обещаний]
 S03 --> S04
 S04 -->|Лекс| S05[05 Обвинение]
 S04 -->|Аврора| S06[06 Защита]
 S04 -->|К уликам| S07[07 Архив]
 S05 --> S06
 S06 --> S05
 S05 --> S07
 S06 --> S07
 S07 -->|Источники или их отсутствие| S08{08 Стратегия}
 S08 -->|Ясность| S09[09 Следствие выбора]
 S08 -->|Доказательства| S09
 S08 -->|Человеческая польза| S09
 S09 --> S10[10 Последствия]
 S09 --> S08
 S10 --> S11{11 Свидетель}
 S11 -->|Буквальная гарантия| S12[12 Поворот]
 S11 -->|Неясные условия| S12
 S12 --> S08
 S12 --> S13[13 Новая формулировка]
 S13 -->|Не менее 16 символов| S14[14 Вердикт]
 S13 --> S08
 S14 --> S13
 S14 --> S15[15 Финал]
 S15 -->|Альтернативный путь| S08
 S15 -->|Новая история| S01
```

Данные состояния: `scene`, `history`, `visited`, `collectibles`, `claim`, `evidence`, `evidenceStatus`, `strategy`, `witness`, `rewrite`, `verdictIssued`, `journey`. Переходы проверяются в `src/engine.js` и имеют единое API `choose`, `back`, `revisit`, `collect`, `setDraft`. Список сцен задан отдельно, в `src/data.js`. UI контроллер `src/app.js` выполняет только визуализацию и вызов методов движка.

## Ограничения

- Нельзя сгенерировать вердикт без осмысленного исправленного текста.
- Выбор стратегии изменяет запись и сбрасывает вердикт.
- Редактирование исходного утверждения сбрасывает зависимые решения.
- Можно вернуться только к посещённым сценам.
- Возражения свидетеля влияют на контекст вердикта, но не являются реальными отзывами покупателей.
- Разглашения через внешние API нет: подготовка JSON является локальным экспортом без автоматически созданной рекламы.
''',encoding='utf-8')

(DOC/'QA_CHECKLIST.md').write_text('''# Чек-лист проверки кино-движка

| Проверка | Метод | Критерий |
|---|---|---|
| Сюжет | Node engine tests + Chromium DOM | 15 известных сцен и доступные переходы |
| Ветвление | Node + Chromium | Три стратегии приводят к разным сохранённым решениям |
| Ошибки ввода | Node | Слишком короткий текст блокирует вердикт |
| Доказательства | Node | Введённый пользователем источник всегда помечен unverified |
| Фрагменты | Node + UI | Печать, архив, свидетель доступны только в своих сценах |
| Экспорт | Chromium | JSON соответствует `adverse.cinematic-brief.v1` |
| Возврат | Chromium | Сцены из истории доступны, недоступные — заблокированы |
| Сохранение | Chromium (симулированный reload) | Состояние восстанавливается из сохранённой записи |
| Звук | Ручная проверка и UI | Изначально выключен; запускается кликом |
| Доступность | UI + визуальный осмотр | Клавиатура, фокус, контраст, снижение движения, субтитры |
| Мобильный экран | Chromium, 390×844 | Нет горизонтального переполнения |
| LITE | Chromium | Убраны CSS-движения и частицы |
| Отсутствующее изображение | Реализация onerror | Сцена остаётся доступной с градиентным фоном |
| Оффлайн | Standalone-HTML | Все изображения и JS вложены в файл |
| Privacy | Инспекция кода | Нет API-запросов, аналитических пикселей, серверной записи |

Примечание: ограничение среды блокирует навигацию Playwright к локальным URL. Для браузерного QA использовано непосредственное внедрение HTML, CSS и JS в Chromium через `set_content`, а сохранение проверено восстановлением state в новую вкладку. Это подтверждает обработчики, отрисовку и интерактивность, но не означает, что URL-доступ по HTTP был проверен через браузер.
''',encoding='utf-8')

(DOC/'RELEASE_STATUS.md').write_text('''# Фактическая поставка и ограничения

## Создано
- 15 конфигурационных сцен, единый нелинейный граф и реальное изменение сохранённого состояния.
- HTML/CSS/JS-приложение без npm, React, сервера и платного AI API.
- 10 базовых фонов в десктопной и мобильной версиях (20 WebP-файлов), включая 4 процедурно написанных окружения.
- Программные плавные движения кадра, частицы и звук WebAudio по нажатию пользователя.
- 3 формы, 3 редакторские стратегии, Свидетель 404, 3 скрытых фрагмента.
- История выборов в localStorage, карта посещённых сцен, reset, отдельные режимы графики и доступности.
- Предварительный эвристический вердикт и ручной JSON-экспорт для дальнейшей обработки вне фильма.
- Автономный HTML с вшитыми ресурсами, тесты Node и браузерная проверка Chromium.
- Визуальная библия, раскадровка, 15 промптов и манифест реальных размеров.

## Не создано и не заявляется
- Нет 15 независимых фотореалистичных кадров настоящего 4K/8K. В кино используются повторно 10 фонов, некоторые апскейлены из маленьких AI-концептов; манифест фиксирует оригиналы.
- Нет синхронизации прогресса с аккаунтом, серверной БД, полноценной аналитики или модерации.
- Нет живого ИИ-персонажа, голоса актёра, дорогого видео, подключённой рекламы или настоящих рекламных конверсий.
- Нет прямого подключения к ADVERSE JUDGE 0.30.0; действие финала — локальный JSON и копирование текста. Для реальной интеграции нужен согласованный импорт в JUDGE и проверки на сервере.
- Юридический и фактологический аудит рекламных утверждений необходим до публикации.

## Уместный следующий релиз
1. Заказать/сгенерировать 5–7 **оригинальных** нативных 1920×1080 фоновых ключевых кадров по `IMAGE_PROMPTS_RU.md`, без печатных надписей.
2. Заменить `art` только в `src/data.js`, выполнить визуальную проверку текстовых safe areas.
3. Добавить серверный импорт JSON в JUDGE по заранее утверждённому контракту; проверять версии, авторизацию и права.
4. Проверить на реальных мобильных устройствах и с реальными пользователями (субтитры, слышимость, контраст, понимание текста).
''',encoding='utf-8')

(ROOT/'README_RU.md').write_text('''# ADVERSE JUDGE — THE TRIAL OF PROMISES

**15-сценный интерактивный кинематографический веб-опыт.** Визуальное введение в рекламную философию ADVERSE JUDGE. Отдельный проект — существующую локальную версию JUDGE 0.30.0 не меняет.

## Мгновенно открыть

Откройте `dist/ADVERSE-JUDGE-CINEMA-STANDALONE.html` двойным кликом. Он автономен: внутри HTML находятся CSS, JavaScript и все 20 изображений WebP. Интернет и API-ключи не нужны. Начните с кнопки **«Войти в историю»**, либо пропустите вступление. Сохраняйте решения, соберите 3 скрытых протокола и получите предварительный редакторский вердикт. JSON скачивается в конце.

## Запуск исходного проекта

Откройте `index.html` двойным кликом или запустите локальный статический сервер:

```bash
python -m http.server 8765
```

Затем откройте `http://localhost:8765` из каталога проекта. Для обычного просмотра **backend не нужен**, а при запуске file:// доступность localStorage зависит от настроек браузера.

## Управление

- Клик по вариантам выбора меняет сюжет; нет автоперелистывания.
- **Досье** внизу экрана показывает историю решений.
- **Карта** в правом верхнем углу позволяет открыть посещённые сцены (также клавиша `M`).
- **Назад** (или клавиша `←`) возвращает к предыдущему выбору.
- **Качество** циклически переключает CINEMATIC / BALANCED / LITE. Настройки позволяют установить LITE и уменьшить движение.
- **Звук** включается только по нажатию. Громкость регулируется через настройки.
- **Сбросить историю** через настройки или финальный выбор удаляет локальный прогресс.
- **Пропустить вступление** сразу открывает рекламное дело.
- **Экспорт** в финале выгружает JSON (не публикует рекламу и не передаёт на внешние сайты).

## Техническая структура

```
index.html                     # точка входа
src/data.js                    # 15 сцен, переходы, персонажи
src/engine.js                  # pure state-machine, аналитические эвристики и brief
src/app.js                     # UI, управление, сохранение и экспорт
src/style.css                  # кино-дизайн, эффекты и адаптив
src/sound.js                   # WebAudio; без аудиофайлов
assets/                        # 20 WebP и favicon.svg
dist/ADVERSE-JUDGE-CINEMA-STANDALONE.html
scripts (tools/)               # сборка HTML и воспроизведение ресурсов
tests/                        # Node и Chromium проверки
docs/                         # раскадровка, style bible, граф, промпты, QA
reports/                      # снимки реально исполненного интерфейса
```

## Тестирование

```bash
node --test tests/engine.test.js
python tests/browser_test.py
```

Для тестов браузера нужен Python `playwright` и установленный Chromium. Для обычного просмотра они не нужны.

## Честные границы

Лекс, Аврора и Свидетель 404 — сценарные программные роли без живого ИИ. Вердикт основан на эвристиках редакторского риска и **не является** юридическим одобрением, доказательством эффективности или рекламной сертификацией. Внешние сайты A–G не подключены, но полученный JSON можно вручную перенести в JUDGE после проверки. Некоторые текущие WebP-фоны созданы из увеличенных фрагментов ранних концептов; настоящий нативный 4K/8K не заявляется. Список размеров в `docs/ASSET_MANIFEST.json`.
''',encoding='utf-8')
print('Wrote',len(list(DOC.glob('*'))),'documentation files; scenes',len(scenes),'assets',len(frames))
