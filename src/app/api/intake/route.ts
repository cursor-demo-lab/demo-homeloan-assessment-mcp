import { storeFromEnv } from "@/intake/store";
import { intakeEndpoint } from "./endpoint";

export const { POST, DELETE, OPTIONS, GET, PUT, PATCH } = intakeEndpoint(storeFromEnv);
