# Deployment and release

## GitHub Pages

1. Create the GitHub repository.
2. Put this project on the `main` branch.
3. Open Settings -> Pages.
4. Set Source to GitHub Actions.
5. The included workflow deploys the website.
6. Later pushes to `main` update the live site.

## Domain

After the GitHub Pages URL works:

1. register the `.org` domain;
2. add it as the custom domain in GitHub Pages;
3. add the DNS records requested by GitHub at the registrar;
4. wait for DNS to update;
5. enable HTTPS.

## GoatCounter

After the live URL works:

1. create the GoatCounter site;
2. copy the `/count` endpoint;
3. paste it into `js/analytics-config.js`;
4. commit and push.

See `docs/analytics.md`.

## GitHub v0.1 and Zenodo

After live testing:

1. add the final repository and website URLs to the metadata;
2. create GitHub tag/release `v0.1`;
3. archive that release in Zenodo;
4. publish the Zenodo software record;
5. add the DOI to `CITATION.cff`, README, website and metadata;
6. commit the DOI update.
