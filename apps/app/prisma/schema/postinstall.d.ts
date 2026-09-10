#!/usr/bin/env node
type GenerateOptions = {
    projectRoot?: string;
    force?: boolean;
    log?: (message: string) => void;
};
export declare function generatePrismaClient(options?: GenerateOptions): {
    schema: string;
};
export {};
//# sourceMappingURL=postinstall.d.ts.map