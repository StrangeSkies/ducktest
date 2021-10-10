import { soften as softenImpl, silence as silenceImpl } from './assertions.js';
export { Ordering, Reporter, Report, Stream, tap } from './tap-output.js';
import { Ordering, Reporter, Report, Stream, tap } from './tap-output.js';
import { TestError } from './test-error.js';
import { SyncAsync, commit } from './commitment.js';

enum TestResult {
    Pass,
    Fail
}
interface Context {
    testcase?: TestImpl;
    subcase?: TestImpl;
    fixture?: TestImpl;
}
interface Tester {
    testcase: Test;
    subcase: Test;
    fixture: Test;
    report(): Report;
    run(reporter: Reporter): SyncAsync<TestResult>;
}
type Test = (description: string, spec: () => SyncAsync) => SyncAsync;
type Action = (description: string, action: (tester: Tester) => SyncAsync) => SyncAsync;
type ContextRunner = (context: Context) => Action;
type TestImpl = (runner: ContextRunner) => Test;

function runFixture(runner: ContextRunner): Action {
    return runner({
        fixture: () => () => { throw new TestError('fixture should not occur during fixture'); },
        testcase: runCase
    });
}

interface CaseContext {
    children: { description: string; runner: ContextRunner }[];
    promise: SyncAsync;
}
function runCase(runner: ContextRunner, subcasesOnPath: Iterable<string> = [], subcasesEncounteredByParent: Set<string> = new Set()): Action {
    return (description, spec): SyncAsync => {
        const context: CaseContext = { children: [], promise: void null };
        const r = runner({ subcase: runSubcase(context, subcasesOnPath, subcasesEncounteredByParent) });

        return r(description, tester => commit()
            .then(() => spec(tester))
            .then(() => context.promise)
            .then(() => {
                if (!tester.report().success) {
                    for (const child of context.children)
                        tester.report().beginSubsection(child.description).end('SKIP enclosing case failed')
                    return;
                }

                const subcasesEncountered = new Set([
                    ...subcasesEncounteredByParent,
                    ...context.children.map(c => c.description)
                ]);

                const promises = context.children.map(child => runCase(
                    child.runner,
                    [...subcasesOnPath, child.description],
                    subcasesEncountered)(
                        child.description,
                        spec));

                if (promises.length > 0 && promises.find(p => p))
                    return Promise.all(promises).then(() => { /*void*/ });
            })
            .honour());
    }
}

function runSubcase(context: CaseContext, subcasesOnPath: Iterable<string>, subcasesEncounteredByParent: Set<string>): TestImpl {
    const c = context;
    const encounteredByParent = subcasesEncounteredByParent;
    const encountered = new Set<string>();

    function checkForDuplicates(description: string) {
        if (encountered.has(description))
            throw new TestError('duplicate subcase name encountered during run');
        encountered.add(description);
    }

    const path = subcasesOnPath[Symbol.iterator]();
    function nextEncounterSubcase(): TestImpl {
        const nextSubcase = path.next();

        return (nextSubcase.done)
            ? runner => {
                const r = runner;
                return description => {
                    checkForDuplicates(description);

                    if (!encounteredByParent.has(description))
                        c.children.push({ description, runner: r });
                }
            }
            : () => (description, spec) => {
                checkForDuplicates(description);

                if (nextSubcase.value === description) {
                    encounterSubcase = nextEncounterSubcase();
                    c.promise = commit()
                        .then(() => c.promise)
                        .then(spec)
                        .honour();
                    return c.promise;
                }

                if (!encounteredByParent.has(description))
                    throw new TestError('encountered unexpected subcase');
            };
    }

    let encounterSubcase = nextEncounterSubcase();

    return runner => {
        const r = runner;
        return (description, spec) => encounterSubcase(r)(description, spec);
    };
}

type Plan = ((tester: Tester) => SyncAsync)[];
interface SynchronousStack {
    parent?: SynchronousStack;
    promise: SyncAsync;
    report: Report;
    description: string;
}
function makeSynchronousTester(): Tester {
    let top: Tester;
    function run(context: Context) {
        const { testcase, subcase, fixture } = context;

        return (stack: SynchronousStack, action: (tester: Tester) => SyncAsync) => {
            const report = stack.report;
            const subsection = runSubsection(stack);
            const previousTop = top;
            top = {
                ...top,
                ...(testcase && { testcase: testcase(subsection) }),
                ...(subcase && { subcase: subcase(subsection) }),
                ...(fixture && { fixture: fixture(subsection) }),
                run() { throw new TestError('report should not occur during report'); },
                report() { return report; }
            };

            return commit()
                .then(() => action(top))
                .finally(() => void (top = previousTop))
                .honour();
        };
    }

    function runSubsection(stack: SynchronousStack): ContextRunner {
        const s = stack;

        return (context) => {
            const r = run(context);

            return (description, action) => {
                const d = description;
                const a = action;

                s.promise = commit()
                    .then(() => s.promise)
                    .then(() => {
                        const subsection = s.report.beginSubsection(d);
                        const substack: SynchronousStack = { parent: s, report: subsection, description: d, promise: void null };

                        return commit()
                            .then(() => r(substack, tester =>
                                commit()
                                    .then(() => a(tester))
                                    .then(() => subsection.end())
                                    .catch(
                                        e => {
                                            if (e instanceof TestError) throw e;
                                            subsection.fail(e);
                                            subsection.end();
                                        })
                                    .honour()))
                            .then(() => substack.promise)
                            .honour();
                    })
                    .honour();
                return s.promise;
            };
        };
    }

    function runPlan(reporter: Reporter, plan: Plan) {
        const report = reporter.beginReport(Ordering.Serial, plan.length);
        const stack: SynchronousStack = { report, description: 'root', promise: void null };
        const r = run({ testcase: runCase, fixture: runFixture });
        const p = plan;

        return commit()
            .then(() => r(stack, tester => {
                const r = tester;
                let c = commit();
                for (const test of p) {
                    c = c.then(() => test(r));
                }
                return c.honour();
            }))
            .then(() => stack.promise)
            .then(() => report.end())
            .catch(e => report.bailOut(e))
            .then(() => report.success ? TestResult.Pass : TestResult.Fail)
            .honour();
    }

    top = makePlanningInterface(runPlan);

    return {
        get run() { return top.run; },
        get testcase() { return top.testcase; },
        get subcase() { return top.subcase; },
        get fixture() { return top.fixture; },
        get report() { return top.report; }
    };
}

function makePlanningInterface(runPlan: (reporter: Reporter, plan: Plan) => SyncAsync<TestResult>): Tester {
    const plan: Plan = [];
    return {
        testcase(description, spec) {
            const d = description;
            const s = spec;
            plan.push(tester => tester.testcase(d, s));
        },
        subcase() {
            throw new TestError('subcase should occur during testcase');
        },
        fixture(description, spec) {
            const d = description;
            const s = spec;
            plan.push(tester => tester.fixture(d, s));
        },
        report() {
            throw new TestError('reporting should occur during test');
        },
        run(reporter) { return runPlan(reporter, plan); }
    };
}

export const defaultReporter: Reporter = tap(console.log);
export class Suite {
    #runner = makeSynchronousTester();

    report(output?: Stream | Reporter): SyncAsync<TestResult> {
        const reporter = output
            ? ('beginReport' in output)
                ? output as Reporter
                : tap(output as Stream)
            : defaultReporter;

        return this.#runner.run(reporter);
    }

    softFail(error: unknown): SyncAsync {
        this.#runner.report().fail(error);
    }
    soften<T>(subject: T): T {
        return softenImpl(subject, e => this.softFail(e))
    }
    softly(action: () => SyncAsync): SyncAsync {
        return commit()
            .then(action)
            .catch(e => this.softFail(e))
            .honour();
    }
    silence = silenceImpl;

    message(message: string): SyncAsync {
        this.#runner.report().diagnostic(message);
    }
    testcase: Test = (description, spec) => { return this.#runner.testcase(description, spec); }
    subcase: Test = (description, spec) => { return this.#runner.subcase(description, spec); }
    fixture: Test = (description, spec) => { return this.#runner.fixture(description, spec); }
}

const s = new Suite();
export default s;
export const softFail = s.softFail.bind(s);
export const soften = s.soften.bind(s);
export const softly = s.softly.bind(s);
export const silence = s.silence.bind(s);
export const testcase = s.testcase.bind(s);
export const subcase = s.subcase.bind(s);
export const report = s.report.bind(s);
export const fixture = s.fixture.bind(s);
export const message = s.message.bind(s);

process?.once?.('beforeExit', async () => {
    process.exit(await report());
});