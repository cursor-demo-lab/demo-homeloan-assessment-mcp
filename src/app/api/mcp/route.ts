import { MIA_AND_DAN_AFTER_CALL } from "@/domain/fixtures/mia-and-dan";
import { latestAnswers, storeFromEnv } from "@/intake/store";
import { mcpEndpoint } from "./server";

const serve = mcpEndpoint([MIA_AND_DAN_AFTER_CALL], () => latestAnswers(storeFromEnv()));

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
