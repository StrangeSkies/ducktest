import { strict as assert } from 'assert';
import { testcase, subcase, Suite, Stream } from '../dist/ducktest.js';
import { TestError } from '../dist/test-error.js';

const emptySpec = () => { /*no test*/ };

testcase('make a new report', async () => {
    const output: string[] = [];
    const stream: Stream = line => output.push(line);
    const s = new Suite();

    subcase('run an empty test', async () => {
        await s.testcase('empty test', emptySpec);
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            'ok - empty test'
        ]);
    });

    subcase('run a failing test', async () => {
        await s.testcase('failing test', () => {
            s.softFail(new Error('failure'));
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[failing test]',
            '    not ok - failure',
            '      ---',
            '      ...',
            '    1..1',
            'not ok - failing test'
        ]);
    });

    subcase('run a test with multiple subtests', async () => {
        s.testcase('passing test', () => {
            s.subcase('subcase one', emptySpec);
            s.subcase('subcase two', emptySpec);
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[passing test]',
            '    ok - subcase one',
            '    ok - subcase two',
            '    1..2',
            'ok - passing test'
        ]);
    });

    subcase('run a test with multiple nested subtests', async () => {
        s.testcase('passing test', () => {
            s.subcase('subcase', () => {
                s.subcase('nested subcase one', emptySpec);
                s.subcase('nested subcase two', emptySpec);
            });
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[passing test]',
            '    [subcase]',
            '        ok - nested subcase one',
            '        ok - nested subcase two',
            '        1..2',
            '    ok - subcase',
            '    1..1',
            'ok - passing test'
        ]);
    });

    subcase('run an asynchronous nested subtests followed by another nested subtest', async () => {
        await s.testcase('passing test', async () => {
            await s.subcase('subcase', async () => {
                await s.subcase('nested subcase one', () =>
                    new Promise(resolve => setTimeout(resolve, 100)));
                s.subcase('nested subcase two', emptySpec);
            });
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[passing test]',
            '    [subcase]',
            '        ok - nested subcase one',
            '        ok - nested subcase two',
            '        1..2',
            '    ok - subcase',
            '    1..1',
            'ok - passing test'
        ]);
    });

    subcase('run a failing subtest followed by another subtest', async () => {
        await s.testcase('test', () => {
            s.subcase('failing subcase', () => {
                s.softFail(new Error('failure'));
            });
            s.subcase('empty subcase', emptySpec);
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[test]',
            '    [failing subcase]',
            '        not ok - failure',
            '          ---',
            '          ...',
            '        1..1',
            '    not ok - failing subcase',
            '    ok - empty subcase',
            '    1..2',
            'not ok - test'
        ]);
    });

    subcase('run an asynchronous failing subtest followed by another subtest', async () => {
        await s.testcase('test', () => {
            s.subcase('failing subcase', async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                s.softFail(new Error('failure'));
            });
            s.subcase('empty subcase', emptySpec);
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[test]',
            '    [failing subcase]',
            '        not ok - failure',
            '          ---',
            '          ...',
            '        1..1',
            '    not ok - failing subcase',
            '    ok - empty subcase',
            '    1..2',
            'not ok - test'
        ]);
    });

    subcase('run an asynchronous failing nested subtests followed by another nested subtest', async () => {
        await s.testcase('passing test', async () => {
            await s.subcase('subcase', async () => {
                await s.subcase('nested subcase one', async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    s.softFail(new Error('failure'));
                });
                s.subcase('nested subcase two', emptySpec);
            });
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[passing test]',
            '    [subcase]',
            '        [nested subcase one]',
            '            not ok - failure',
            '              ---',
            '              ...',
            '            1..1',
            '        not ok - nested subcase one',
            '        ok - nested subcase two',
            '        1..2',
            '    not ok - subcase',
            '    1..1',
            'not ok - passing test'
        ]);
    });

    subcase('run a failing test case with subcases', async () => {
        await s.testcase('test', () => {
            s.softFail(new Error('failure'));
            s.subcase('failing subcase', () => {
                s.softFail(new Error('failure'));
            });
            s.subcase('empty subcase', emptySpec);
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[test]',
            '    not ok - failure',
            '      ---',
            '      ...',
            '    ok - failing subcase # SKIP enclosing case failed',
            '    ok - empty subcase # SKIP enclosing case failed',
            '    1..3',
            'not ok - test'
        ]);
    });

    subcase('bail out of a test case after a message', async () => {
        await s.testcase('test', () => {
            s.message('message');
            throw new TestError('cause');
        });
        await s.report(stream);
        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[test]',
            '    # message',
            'Bail out! cause'
        ]);
    });

    subcase('bail out of a subcase after a message', async () => {
        await s.testcase('test', () => {
            s.subcase('subcase', () => {
                s.message('message');
                throw new TestError('cause');
            });
        });
        await s.report(stream);

        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[test]',
            '    [subcase]',
            '        # message',
            'Bail out! cause'
        ]);
    });

    subcase('bail out of a nested subcase after a message', async () => {
        await s.testcase('test', () => {
            s.subcase('subcase', () => {
                s.subcase('nested subcase', () => {
                    s.message('message');
                    throw new TestError('cause');
                });
            });
        });
        await s.report(stream);

        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[test]',
            '    [subcase]',
            '        [nested subcase]',
            '            # message',
            'Bail out! cause'
        ]);
    });

    subcase('bail out of a subcase before another subcase', async () => {
        await s.testcase('test', () => {
            s.subcase('errored subcase', () => {
                throw new TestError('cause');
            });
            s.subcase('subcase', emptySpec);
        });
        await s.report(stream);

        await new Promise(resolve => setTimeout(resolve, 100));

        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            'Bail out! cause'
        ]);
    });

    subcase('bail out of a subcase asynchronously before another subcase', async () => {
        await s.testcase('test', () => {
            s.subcase('errored subcase', async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                throw new TestError('cause');
            });
            s.subcase('subcase', emptySpec);
        });
        await s.report(stream);

        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            'Bail out! cause'
        ]);
    });

    subcase('run tests synchronously within a fixture', async () => {
        await s.fixture('fixture', () => {
            let message = 'message';
            s.testcase('first test', () => {
                s.message(message);
            });
            message = 'again'
            s.testcase('second test', () => {
                s.message(message);
            });
            message = 'oops!';
        });
        await s.report(stream);

        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[fixture]',
            '    [first test]',
            '        # message',
            '        1..0',
            '    ok - first test',
            '    [second test]',
            '        # again',
            '        1..0',
            '    ok - second test',
            '    1..2',
            'ok - fixture'
        ]);
    });

    subcase('run tests asynchronously within a fixture', async () => {
        await s.fixture('fixture', async () => {
            let message = 'message';
            await s.testcase('first test', async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                s.message(message);
            });
            message = 'again'
            await s.testcase('second test', async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                s.message(message);
            });
            message = 'oops!';
        });
        await s.report(stream);

        assert.deepEqual(output, [
            'TAP version 13',
            '1..1',
            '[fixture]',
            '    [first test]',
            '        # message',
            '        1..0',
            '    ok - first test',
            '    [second test]',
            '        # again',
            '        1..0',
            '    ok - second test',
            '    1..2',
            'ok - fixture'
        ]);
    });
});
