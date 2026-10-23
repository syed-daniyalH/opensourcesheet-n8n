# Third-party reuse record

No third-party source code has been copied into this foundation yet.

Candidate decisions:

- `gristlabs/grist-core`: use the supported REST API and adapt the official Docker Compose patterns.
- `gristlabs/grist-api`: inspect as a Node/TypeScript client reference; do not add directly until its dependency age and API coverage are verified.
- `gristlabs/py_grist_api`: consider only if the final integration runtime is Python; run compatibility tests first.
- `gristlabs/grist-omnibus`: reject for new deployments because the repository is deprecated.
- `scrapy/scrapy`, `apify/crawlee`, `taskforcesh/bullmq`, and `celery/celery`: conditional candidates only; do not add until the target runtime, crawl volume, queue requirements, and deployment budget are known.

When code is eventually reused, record the source URL, commit, path, license, changes, and required attribution here.
