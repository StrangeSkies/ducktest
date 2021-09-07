export * from './assertions.js';
import { soften, silence } from './assertions.js';
export * from './tap-output.js';
import { tap, Reporter, Report, Stream } from './tap-output.js';
import { TestError } from './test-error.js';

type Spec = () => Promise<void> | void;

function peek<T>(array: T[]) { return array[array.length - 1]; }

interface TestcaseContext {
    description: string;
    subcases: Set<string>;
    subcase: Iterator<string>;
    complete: Promise<void>;
    report: Report;
};

function makeTestcaseContext(description: string, report: Report): TestcaseContext {
    return {
        description,
        subcases: new Set(),
        subcase: [][Symbol.iterator](),
        complete: Promise.resolve(),
        report: report.beginSubtest(description)
    };
}

interface TestcaseState {
    currentReport: Report;
    currentPass: {
        subcasesEncountered: Set<string>;
    }
    stackIndex: number;
    stack: TestcaseContext[];
};

function makeTestcaseState(baseReport: Report): TestcaseState {
    const base = baseReport;
    return {
        get currentReport() { return peek(this.stack)?.report ?? base; },
        currentPass: {
            subcasesEncountered: new Set<string>()
        },
        stackIndex: 0,
        stack: []
    };
}

export const defaultStream: Stream = {
    write: () => { },
    open() {
        this.write = console.log;
        console.log = line => {
            this.write('# ' + line);
        };
    },
    close() {
        console.log = this.write;
    }
};
export const defaultReporter: Reporter = tap;
export function suite() {
    async function nextPass(state: TestcaseState, desc: string, spec: Spec): Promise<string> {
        const s = state;
        // run begin
        s.stack.push(makeTestcaseContext(desc, s.currentReport));

        s.currentPass.subcasesEncountered.clear();
        try {
            await spec();
            await s.stack[0].complete;
        } catch (e) {
            s.currentReport.fail(e);
        }
        peek(s.stack).subcase = peek(s.stack).subcases[Symbol.iterator]();

        let value;
        if (!s.currentReport.success) {
            while (!({ value } = (peek(s.stack)?.subcase?.next() ?? {}))?.done) {
                s.currentReport?.beginSubtest(value).end('SKIP enclosing case failed')
            }
        }

        while (({ value } = (peek(s.stack)?.subcase?.next() ?? {}))?.done) {
            // run complete
            s.stack.pop()?.report.end();
        }
        return value;
    }

    async function nextSubcase(state: TestcaseState, spec: Spec) {
        const s = state;
        s.stackIndex++;
        try {
            await spec();
            await s.stack[s.stackIndex].complete;
        } catch (e) {
            s.currentReport.fail(e);
        }
        s.stackIndex--;
    }

    async function scheduleSubcase(state: TestcaseState, description: string) {
        const s = state;
        s.stack[s.stackIndex].subcases.add(description);
    }

    async function skipSubcase() { }

    const tests: ((report: Report) => Promise<void>)[] = [];
    let testcaseState: TestcaseState | null;
    return {
        assertions: {
            softFail(error: any) {
                if (!testcaseState)
                    throw ''; // TODO
                testcaseState.currentReport.fail(error);
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

        testcase(description: string, spec: Spec): void {
            tests.push(async report => {
                try {
                    testcaseState = makeTestcaseState(report);
                    const s = spec;
                    let desc = description;
                    do {
                        desc = await nextPass(testcaseState, desc, s);
                    } while (desc);
                } finally {
                    testcaseState = null;
                }
            });
        },

        subcase(description: string, spec: Spec): Promise<void> {
            if (!testcaseState)
                throw ''; // TODO

            if (testcaseState.stack.length === 0) {
                throw new TestError('subcase should appear inside testcase');
            }

            if (testcaseState.currentPass.subcasesEncountered.has(description)) {
                throw new TestError('duplicate subcase name encountered during run');
            } else {
                testcaseState.currentPass.subcasesEncountered.add(description);
            }

            if (testcaseState.stack[testcaseState.stackIndex + 1]?.description === description) {
                const i = testcaseState.stackIndex;
                return testcaseState.stack[i].complete = nextSubcase(testcaseState, spec);
            }

            for (let i = 0; i <= testcaseState.stackIndex; i++) {
                if (testcaseState.stack[i].subcases.has(description)) {
                    return skipSubcase();
                }
            }

            if ((testcaseState.stackIndex + 1) == testcaseState.stack.length) {
                return scheduleSubcase(testcaseState, description);
            }

            return Promise.reject(new TestError('encountered unexpected subcase'));
        },

        fixture(description: string, spec: Spec): void {
            tests.push(() => {
                return Promise.reject(new TestError('fixtures are not implemented'));
            });
        },

        async report(stream: Stream = defaultStream, reporter: Reporter = defaultReporter): Promise<void> {
            const r = reporter(stream);
            for (const test of tests) {
                await test(r);
            }
            r.end();
        }
    };
};

const s = suite();
export const assertions = s.assertions;
export const testcase = s.testcase.bind(s);
export const subcase = s.subcase.bind(s);
export const report = s.report.bind(s);

if (process?.on) {
    process?.on('exit', () => report());
}

