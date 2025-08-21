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

.PHONY: check-data
check-data:
	@awk -F'[ ,:]' 'NR>1{bad=($$2<0||$$2>23||$$3<0||$$3>59||$$4<0||$$4>59); if(bad){print "Invalid time at line", NR, ":", $$0; any=1}} END{exit any}' ./data/data.csv
