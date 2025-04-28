import { LetterboxdPoster } from "./lib/letterboxd/list";
import express from "express";
import { normalizeSlug } from "./lib/letterboxd/util";
import { transformLetterboxdMovieToRadarr } from "./lib/radarr/transform";
import {
    getMoviesDetailCached,
    LetterboxdMovieDetails,
} from "./lib/letterboxd/movie-details";
import { sendChunkedJson } from "./lib/express/send-chunked-json";
import { fetchPostersFromSlug } from "./lib/letterboxd";
import { logger } from "./lib/logger";
import { cache } from "./lib/cache";
import { getFilteredMovie } from "./lib/streamings"

const appLogger = logger.child({ module: "App" });

const PORT = process.env.PORT || 5543;


let movieCount = 0; // Counter for the number of movies exported
let maxResults = 0;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
const server = app.listen(PORT, () => {
    appLogger.info(`Listening on port ${PORT}`);
});


server.keepAliveTimeout = 78;

app.get("/", (_, res) => res.send("Use letterboxd.com path as path here."));

app.get("/favicon.ico", (_, res) => res.status(404).send());

app.get(/(.*)/, async (req, res) => {
    const chunk = sendChunkedJson(res);

    let isConnectionOpen = true;
    let isFinished = false;
    req.connection.once("close", () => {
        isConnectionOpen = false;
        movieCount = 0;
        if (!isFinished) {
            appLogger.warn("Client closed connection before finish.");
        }
    });

    const slug = normalizeSlug(req.params[0]);
    const limit = req.query.limit
        ? Number.parseInt(req.query.limit)
        : undefined;

    let posters: LetterboxdPoster[];

    try {
        appLogger.info(`Fetching posters for ${slug}`);
        posters = await fetchPostersFromSlug(slug);
        if (!Array.isArray(posters)) {
            throw new Error(`Fetching posters failed for ${slug}`);
        }

        const sortParam = req.query.sort;
        const reverseParam = req.query.reverse?.toLowerCase() === "true";
        maxResults = req.query.max ? Number.parseInt(req.query.max) : 0;
        appLogger.info(`Max results: ${maxResults}`);

        if (sortParam === "added") {
            posters.sort((a, b) => {
                if (!a.addedAt || !b.addedAt) return 0;
                const diff = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
                return reverseParam ? -diff : diff;
            });
        }

        if (limit) {
            posters = posters.slice(0, limit);
        }
    } catch (e: any) {
        isFinished = true;
        appLogger.error(`Failed to fetch posters for ${slug} - ${e?.message}`);
        chunk.fail(404, e?.message);
        isConnectionOpen = false;
        return;
    }

    const movieSlugs = posters.map((poster) => poster.slug);

    // Collect transformed movies first
    const transformedMovies: any[] = [];

    const onMovie = (movie: LetterboxdMovieDetails) => {
        if (!movie.tmdb) return;
        const transformed = transformLetterboxdMovieToRadarr(movie);
        transformedMovies.push(transformed);
    };

    try {
        await getMoviesDetailCached(
            movieSlugs,
            7,
            onMovie,
            () => !isConnectionOpen
        );
    } catch (e: any) {
        appLogger.error(`Failed to fetch movies for ${slug} - ${e?.message}`);
        chunk.fail(404, e?.message);
        isConnectionOpen = false;
        return;
    }

    appLogger.info(`Fetched ${transformedMovies.length} transformed movies.`);

    // Now run getFilteredMovie on the collected list
    for (const movie of transformedMovies) {
        if (maxResults > 0 && movieCount >= maxResults) {
            appLogger.info("Reached max results limit.");
            break;
        }

        try {
            const OutMovie = await getFilteredMovie(movie);
            if (OutMovie) {
                chunk.push(OutMovie);
                movieCount++;
                await delay(10); // optional small delay
            }
        } catch (err) {
            appLogger.error("Error filtering movie", err);
        }

        if (!isConnectionOpen) {
            appLogger.warn("Client disconnected during filtering.");
            break;
        }
    }

    isFinished = true;
    chunk.end();
});

process.on("unhandledRejection", (reason) => {
    throw reason;
});

process.on("uncaughtException", (error) => {
    appLogger.error("Uncaught Exception", error);
    process.exit(1);
});
