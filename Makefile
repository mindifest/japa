.PHONY: merge
merge:
	@reset
	@bash bin/merge.sh

.PHONY: rollup-test
merge-test:
	@reset
	@bash bin/merge_test.sh

.PHONY: fake
fake:
	@reset
	@node bin/fake.js 800