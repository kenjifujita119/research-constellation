/** Page URLs are built here and nowhere else.
 *
 *  The pages are exported as static files. (They used to be served by the original Python server,
 *  which is not included here, from the same process as its API, on one dyno.) Static export
 *  cannot handle dynamic routes such as `/shape/[orcid]`, so who to show is passed in the query.
 *  The trailing `/` matches trailingSlash in next.config — FastAPI's static serving only read the
 *  `shape/index.html` form, so without it every visit went through one extra redirect. */

export const shapeHref = (orcid: string) => `/shape/?orcid=${encodeURIComponent(orcid)}`;

export const reachHref = (orcid: string) => `/reach/?orcid=${encodeURIComponent(orcid)}`;

export const graphHref = (job: string) => `/graph/?job=${encodeURIComponent(job)}`;

/** Collaborator search. The job key for a network expanded to second-degree is `{orcid}_h2`. */
export const collaboratorsHref = (orcid: string) => graphHref(`${orcid}_h2`);
