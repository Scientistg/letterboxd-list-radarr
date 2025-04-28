import 'dotenv/config';
import axios from 'axios';
import { RadarrMovieDetails } from './types';
import { logger } from "../logger";

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const COUNTRY = process.env.COUNTRY!;
const STREAMING_SERVICES = process.env.STREAMING_SERVICES!.split(',').map(s => s.trim().toLowerCase());

const streamingsLogger = logger.child({ module: "StreamingsDetails" });


export const fetchStreamingAvailability = async (movieId: number): Promise<string[]> => {
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}/watch/providers`,
      {
        params: { api_key: TMDB_API_KEY },
      }
    );

    const providers = response.data.results;
    const availableServices: string[] = [];

    const regionProviders = providers[COUNTRY];
    if (!regionProviders || !regionProviders.flatrate) return [];

        regionProviders.flatrate.forEach((service: any) => {
        if (STREAMING_SERVICES.includes(service.provider_name.toLowerCase())) {
            availableServices.push(service.provider_name.toLowerCase());
        }
    });

    streamingsLogger.info(`Streamings found: ${availableServices}`);
    return availableServices;
  } catch (err: any) {
    console.error(`Error fetching streaming availability for ID ${movieId}:`, err.message);
    return [];
  }
};

export const getFilteredMovie = async (movie: RadarrMovieDetails): Promise<RadarrMovieDetails | null> => {
  streamingsLogger.info(movie?.id);
  if (movie?.id) {
    const available = await fetchStreamingAvailability(movie.id);
    streamingsLogger.info(available);
    if (available.length === 0) {
      return movie;
    }
  }
  return null;

};


