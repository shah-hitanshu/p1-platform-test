import { createP1Handler } from "@pantheon-systems/p1-client-sdk/server";
import config from "../../../../puck.config";

const handler = createP1Handler({ config });

export const { GET, POST, DELETE } = handler;
