import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler';

/**
 * The DEBUG flag will do two things that help during development:
 * 1. we will skip caching on the edge, which makes it easier to
 *    debug.
 * 2. we will return an error message on exception in your Response rather
 *    than the default 404.html page.
 */
const DEBUG = false;

addEventListener('fetch', (event) => {
  try {
    event.respondWith(handleEvent(event));
  } catch (e) {
    if (DEBUG) {
      return event.respondWith(
        new Response(e.message || e.toString(), {
          status: 500,
        }),
      );
    }
    event.respondWith(new Response('Internal Error', { status: 500 }));
  }
});

function addCustomHeaders(requestURL, response) {
  const regex = new RegExp(/\S+\/(js|css|img)\/\S+/);
  const { headers } = response;

  // Set caching headers
  if (regex.test(requestURL)) {
    // For assets with hashes in filename we can instruct the browser to cache without
    // revalidation.
    headers.append('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    // All other files should always be revalidated
    headers.append('Cache-Control', 'must-revalidate');
  }

  // Security headers
  headers.append('X-Frame-Options', 'DENY');
  headers.append('X-Content-Type-Options', 'nosniff');
  headers.append('X-XSS-Protection', '1; mode=block');
  headers.append('Referrer-Policy', 'no-referrer');
}

async function handleEvent(event) {
  const url = new URL(event.request.url);
  const options = {};

  options.mapRequestToAsset = (req) => {
    // First let's apply the default handler, which we imported from
    // '@cloudflare/kv-asset-handler' at the top of the file. We do
    // this because the default handler already has logic to detect
    // paths that should map to HTML files, for which it appends
    // `/index.html` to the path.
    req = mapRequestToAsset(req);

    // Now we can detect if the default handler decided to map to
    // index.html in some specific directory.
    if (req.url.endsWith('/index.html')) {
      // Indeed. Let's change it to instead map to the root `/index.html`.
      // This avoids the need to do a redundant lookup that we know will
      // fail.
      return new Request(`${new URL(req.url).origin}/index.html`, req);
    }
    // The default handler decided this is not an HTML page. It's probably
    // an image, CSS, or JS file. Leave it as-is.
    return req;
  };

  try {
    if (DEBUG) {
      // customize caching
      options.cacheControl = {
        bypassCache: true,
      };
    }
    const response = await getAssetFromKV(event, options);
    addCustomHeaders(url, response);
    return response;
  } catch (e) {
    // if an error is thrown try to serve the asset at 404.html
    if (!DEBUG) {
      try {
        const notFoundResponse = await getAssetFromKV(event, {
          mapRequestToAsset: (req) => new Request(`${new URL(req.url).origin}/404.html`, req),
        });

        return new Response(notFoundResponse.body, { ...notFoundResponse, status: 404 });
      } catch (e) {}
    }

    return new Response(e.message || e.toString(), { status: 500 });
  }
}
