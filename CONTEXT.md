## Image Fetching

News cards support thumbnail images.

Image fetching follows this order:

1. media:thumbnail
2. hatena:imageurl
3. enclosure (image/* only)
4. first image inside content:encoded
5. og:image
6. twitter:image

Stop after the first successful match.

---

Only perform HTML requests when RSS does not provide an image.

---

Google News is a special case.

Do not resolve the Google News redirect URL.

Do not access Google's internal batchexecute API.

Do not use Google News branding images.

Instead, display the project's own placeholder image.

---

Image fetching is asynchronous.

RSS synchronization only creates pending work.

A queue worker triggered via Vercel Queues performs HTML fetching.

---

ImageFetchStatus is an enum.

Possible values:

* QUEUED
* PROCESSING
* SUCCESS
* NOT_FOUND
* FAILED

PROCESSING prevents duplicate work when multiple workers execute simultaneously.

claimImageFetchLock() atomically claims work when the item is QUEUED, when the
same queue message is redelivered, or when an earlier PROCESSING claim has
expired.

Both the Vercel Queue route and the local debug route call
processImageFetchJob(). The routes only adapt Queue metadata or HTTP responses;
locking, robots.txt checks, image fetching, and status updates belong to the
shared job processor.


---

HTML fetching should

* run with concurrency = 5
* use request timeouts
* convert relative image URLs into absolute URLs
* leave retryable communication failures as PROCESSING and rethrow them for Queue redelivery
* treat permanent failures as FAILED
* treat missing metadata as NOT_FOUND

---

Implementation should keep responsibilities separated.

Preferred modules:

* extractRssImage()
* resolveArticleUrl()
* fetchOgImage()
* updateImageStatus()
* claimImageFetchLock()
* processImageFetchJob()

Avoid implementing image fetching as one large function.

---

## Orphaned QUEUED Items Recovery

To prevent processing drops between DB save and Queue enqueue, a recovery mechanism is implemented:

- **DB Transaction**: `saveNewsToDb()` uses `prisma.$transaction` to atomically save news items and category relations
- **Queue Error Tracking**: `enqueueImageFetch()` returns success/failure counts and failed IDs instead of swallowing errors
- **Recovery Sweeper**: `recoverOrphanedQueuedItems()` finds items with `imageFetchStatus = 'QUEUED'` older than 5 minutes and re-enqueues them
- **Automatic Recovery**: `syncNews()` automatically calls the recovery function after each sync cycle

This ensures that items stuck in QUEUED state due to process crashes, network errors, or rate limits are eventually re-processed. The existing `claimImageFetchLock()` mechanism ensures idempotency even if items are re-enqueued multiple times.
