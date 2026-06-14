# Parley data platform — convenience targets.
# Usage: make <target>   (run from the data-pipeline/ directory)

.PHONY: help install jdk env extract transform load run full test query spark-up spark-down clean

help:
	@echo "Parley data platform"
	@echo "  make install      install Python deps into the active environment"
	@echo "  make jdk          install a Spark-compatible JDK 17 locally (.jdk17/)"
	@echo "  make env          create .env from .env.example (if missing)"
	@echo "  make run          full pipeline: extract -> transform -> load"
	@echo "  make full         full pipeline with --full-refresh"
	@echo "  make extract      MongoDB  -> bronze parquet"
	@echo "  make transform    bronze   -> gold star schema (Spark)"
	@echo "  make load         gold     -> Snowflake | DuckDB"
	@echo "  make query        run sql/analytics_queries.sql against DuckDB"
	@echo "  make test         pytest the Spark transform"
	@echo "  make spark-up     start the standalone Spark cluster (docker)"
	@echo "  make clean        remove the local lakehouse (data/)"

install:
	pip install -r requirements.txt

# Spark 3.5 needs Java 8/11/17. If your system Java is newer (21/25), this
# installs a compatible JDK 17 into .jdk17/ which the transform auto-detects.
jdk:
	conda create -y -p "$(CURDIR)/.jdk17" -c conda-forge "openjdk=17"

env:
	@test -f .env || (cp .env.example .env && echo "created .env — edit it if needed")

extract:
	python pipeline.py --steps extract

transform:
	python pipeline.py --steps transform

load:
	python pipeline.py --steps load

run:
	python pipeline.py

full:
	python pipeline.py --full-refresh

test:
	pytest tests -q

query:
	python query.py

spark-up:
	docker compose -f docker-compose.spark.yml up -d

spark-down:
	docker compose -f docker-compose.spark.yml down

clean:
	rm -rf data/
