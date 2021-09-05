export * from './assertions.js';
import { soften, silence } from './assertions.js';
export * from './tap-output.js';
import { tap, Reporter, Ordering } from './tap-output.js';
import { TestError } from './test-error.js';

type Spec = () => Promise<void> | void;

interface Context {
    description: string,
    subcases: Set<string>,
    subcase: Iterator<string>,
    complete: Promise<void>,
    reporter: Reporter
};

function makeContext(description: string, reporter: Reporter): Context {
    return {
        description,
        subcases: new Set(),
        subcase: [][Symbol.iterator](),
        complete: Promise.resolve(),
        reporter: reporter.beginSubtest(description)
    };
}
function peek<T>(array: T[]) { return array[array.length - 1]; }

export function suite(reporter?: Reporter) {
    const baseReporter = reporter ?? tap(console.log);
    const currentReporter = () => peek(stack)?.reporter ?? baseReporter;

    let currentTest: Promise<void> = Promise.resolve();
    const currentPass = {
        subcasesEncountered: new Set<string>()
    };

    let contextIndex = 0;
    const stack: Context[] = [];

    async function nextPass(desc: string, spec: Spec): Promise<string> {
        // run begin
        stack.push(makeContext(desc, currentReporter()));

        currentPass.subcasesEncountered.clear();
        try {
            await spec();
            await stack[0].complete;
        } catch (e) {
            currentReporter().fail(e);
        }
        peek(stack).subcase = peek(stack).subcases[Symbol.iterator]();

        let value;
        if (!currentReporter().success) {
            while (!({ value } = (peek(stack)?.subcase?.next() ?? {}))?.done) {
                currentReporter()?.beginSubtest(value).end('SKIP enclosing case failed')
            }
        }

        while (({ value } = (peek(stack)?.subcase?.next() ?? {}))?.done) {
            // run complete
            stack.pop()?.reporter.end();
        }
        return value;
    }

    async function nextSubcase(spec: Spec) {
        contextIndex++;
        try {
            await spec();
            await stack[contextIndex].complete;
        } catch (e) {
            currentReporter().fail(e);
        }
        contextIndex--;
    }

    async function scheduleSubcase(description: string) {
        stack[contextIndex].subcases.add(description);
    }

    async function skipSubcase() { }

    return {
        assertions: {
            softFail(error: any) {
                currentReporter().fail(error);
            },
            soften<T extends object>(subject: T): T {
                return soften(subject, this.softFail)
            },
            async softly(action: () => Promise<void> | void) {
                try {
                    await action();
                } catch (e) {
                    this.softFail(e);
                }
            },
            silence
        },

        testcase(description: string, spec: Spec): Promise<void> {
            const previousTest = currentTest;

            const s = spec;
            let desc = description;
            return currentTest = previousTest.then(async () => {
                do {
                    desc = await nextPass(desc, s);
                } while (desc);
            });
        },

        subcase(description: string, spec: Spec): Promise<void> {
            if (stack.length === 0) {
                throw new TestError('subcase should appear inside testcase');
            }

            if (currentPass.subcasesEncountered.has(description)) {
                throw new TestError('duplicate subcase name encountered during run');
            } else {
                currentPass.subcasesEncountered.add(description);
            }

            if (stack[contextIndex + 1]?.description === description) {
                const cc = contextIndex;
                return stack[cc].complete = nextSubcase(spec);
            }

            for (let i = 0; i <= contextIndex; i++) {
                if (stack[i].subcases.has(description)) {
                    return skipSubcase();
                }
            }

            if ((contextIndex + 1) == stack.length) {
                return scheduleSubcase(description);
            }

            return Promise.reject(new TestError('encountered unexpected subcase'));
        }
    };
}

const defaultSuite = suite();

export const assertions = defaultSuite.assertions;
export const testcase = defaultSuite.testcase;
export const subcase = defaultSuite.subcase;
