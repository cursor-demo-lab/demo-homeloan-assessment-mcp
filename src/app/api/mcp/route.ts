import { MIA_AND_DAN_AFTER_CALL } from "@/domain/fixtures/mia-and-dan";
import { mcpEndpoint } from "./server";

const serve = mcpEndpoint([MIA_AND_DAN_AFTER_CALL]);

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
