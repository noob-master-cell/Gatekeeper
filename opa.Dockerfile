FROM openpolicyagent/opa:0.68.0-static

COPY policies /policies

ENTRYPOINT ["opa"]
CMD ["run", "--server", "--addr=0.0.0.0:8181", "--log-level=info", "/policies"]
