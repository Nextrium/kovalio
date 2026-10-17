<h1 align="center">Kovalio</h1>

<p align="center">
  Платформа развёртывания с открытым исходным кодом для самостоятельного хостинга со встроенным CI/CD.<br>
  Отправляйте код, запускайте контейнеры, управляйте инфраструктурой — через приложение для рабочего стола, веб-дашборд или интерфейс командной строки (CLI).
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kovalio"><img src="https://img.shields.io/npm/v/kovalio?color=0b7285&label=npm" alt="npm version" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" /></a>
  <a href="https://nextrium.org"><img src="https://img.shields.io/badge/website-nextrium.org-0b7285" alt="Website" /></a>
</p>

<p align="center">
  <a href="#быстрый-старт">Быстрый старт</a> ·
  <a href="#возможности">Возможности</a> ·
  <a href="#три-интерфейса">Интерфейсы</a> ·
  <a href="https://nextrium.org/docs">Документация</a> ·
  <a href="../../CONTRIBUTING.md">Участие в разработке</a>
</p>

<p align="center">
  <a href="../../README.md"><img src="https://img.shields.io/badge/lang-English-555" alt="English" /></a>
  <a href="README.ar.md"><img src="https://img.shields.io/badge/lang-العربية-555" alt="العربية" /></a>
  <a href="README.zh.md"><img src="https://img.shields.io/badge/lang-简体中文-555" alt="简体中文" /></a>
  <a href="README.es.md"><img src="https://img.shields.io/badge/lang-Español-555" alt="Español" /></a>
  <a href="README.fr.md"><img src="https://img.shields.io/badge/lang-Français-555" alt="Français" /></a>
  <a href="README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-555" alt="日本語" /></a>
  <a href="README.pt.md"><img src="https://img.shields.io/badge/lang-Português-555" alt="Português" /></a>
  <a href="README.de.md"><img src="https://img.shields.io/badge/lang-Deutsch-555" alt="Deutsch" /></a>
  <a href="README.tr.md"><img src="https://img.shields.io/badge/lang-Türkçe-555" alt="Türkçe" /></a>
  <a href="README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-555" alt="한국어" /></a>
  <a href="README.ru.md"><img src="https://img.shields.io/badge/lang-Русский-0b7285" alt="Русский" /></a>
</p>

<p align="center">
  <img src="../screenshots/screen.png" alt="Kovalio dashboard" width="800" />
</p>

---

## Быстрый старт

```bash
npm i -g kovalio     # или: curl -fsSL https://get.kovalio.nextrium.org | sh
kovalio up           # устанавливает Kovalio как фоновую службу (автозапуск при загрузке)
```

`kovalio open` открывает панель управления; `kovalio stop` останавливает службу. Для разового запуска: `kovalio up --foreground`. Для деплоя проекта:

```bash
cd your-project
kovalio init         # связать эту папку с проектом
kovalio deploy
```

Предпочитаете Docker? Клонируйте репозиторий и используйте Compose:

```bash
git clone https://github.com/Nextrium/kovalio.git && cd kovalio
cp .env.example .env
docker compose up -d
```

Или установите приложение для рабочего стола (`kovalio install` или скачайте с [nextrium.org](https://nextrium.org)).

---

## Что делает Kovalio

Укажите репозиторий. Kovalio автоматически определит стек, соберёт проект, всё настроит и запустит — без необходимости писать файлы конфигурации, пайплайны или YAML.

Базы данных, домены, SSL, CDN, почта, резервные копии — всё управляется в едином окне.

Работает с **Kovalio Cloud** (управляемый хостинг) или на **любом вашем сервере Linux**. Подходит как для индивидуальных разработчиков с пет-проектами, так и для команд с нагруженным продакшеном.

---

## Возможности

| | |
|---|---|
| **Встроенный CI/CD** | Деплой по пушу, превью-окружения, цепочки staging/prod, мгновенные откаты |
| **Любой стек** | Node, Python, Go, Rust, PHP, Ruby, Java, .NET, Docker, монорепозитории |
| **Полноценный бэкенд** | Postgres, MySQL, MongoDB, Redis, фоновые воркеры, WebSockets, тома данных |
| **Домены и SSL** | Автоматические сертификаты Let's Encrypt, wildcard-домены, автопродление |
| **CDN** | Кэширование на границе (Edge), HTTP/3, сжатие Brotli, мгновенный сброс кэша |
| **Почтовый сервер** | Встроенный SMTP с DKIM/SPF/DMARC — без нужды в сторонних сервисах вроде Mailgun |
| **Резервные копии** | По расписанию, базы данных и тома, восстановление в один клик, экспорт в любое время |
| **Мониторинг в реальном времени** | Логи сборки, метрики контейнеров и нагрузка на ресурсы прямо на экране |
| **Масштабирование** | Автомасштабирование в Cloud, поддержка мультинодовых кластеров при self-host |
| **Переносимость** | Стандартные контейнеры Docker — меняйте провайдеров в любой момент |
| **Docker Compose** | Запуск существующих файлов Compose без изменений |

---

## Развёртывание где угодно

- **Kovalio Cloud** — управляемый сервис, автомасштабирование, нулевая настройка
- **Любой VPS** — Hetzner, DigitalOcean, Linode, Timeweb, Selectel, OVH и другие
- **Выделенные серверы** — Bare Metal, Colocation, домашние серверы (Homelab)
- **Кластеры серверов** — распределяйте сервисы по нескольким машинам

Одинаково удобный интерфейс вне зависимости от места размещения.

---

## Три интерфейса

- **Десктопное приложение** — наглядный графический интерфейс, логи в реальном времени, всё в один клик.
- **Веб-дашборд** — тот же интерфейс в браузере, созданный для командной работы.
- **CLI** — для скриптов и автоматизации в терминале.

Также доступны **REST API** и протокол **MCP** (Model Context Protocol для ИИ-агентов). Подробная документация доступна на [nextrium.org/docs](https://nextrium.org/docs).

---

## Лицензия

Kovalio — программное обеспечение с **открытым исходным кодом** под лицензией [Apache License 2.0](../../LICENSE).

Вы можете использовать, запускать, модифицировать, размещать на своих серверах и распространять его — в том числе в коммерческих продуктах — в соответствии с условиями лицензии Apache 2.0.
