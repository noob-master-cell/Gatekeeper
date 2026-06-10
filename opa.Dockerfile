FROM openpolicyagent/opa:0.68.0-static

# Copy non-test Rego files only — *_test.rego is for `opa test` in CI.
COPY policies/authz.rego /policies/authz.rego

ENTRYPOINT ["opa"]
CMD ["run", "--server", "--addr=0.0.0.0:8181", "--log-level=info", "/policies"]
