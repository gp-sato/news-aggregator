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

A separate cron job performs HTML fetching.

---

ImageFetchStatus is an enum.

Possible values:

* PENDING
* PROCESSING
* SUCCESS
* NOT_FOUND
* FAILED

PROCESSING prevents duplicate work when multiple workers execute simultaneously.

---

HTML fetching should

* run with concurrency = 5
* use request timeouts
* convert relative image URLs into absolute URLs
* treat communication failures as FAILED
* treat missing metadata as NOT_FOUND

---

Implementation should keep responsibilities separated.

Preferred modules:

* extractRssImage()
* resolveArticleUrl()
* fetchOgImage()
* updateImageStatus()

Avoid implementing image fetching as one large function.
