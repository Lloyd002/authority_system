from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.dummy import DummyOperator
from datetime import datetime

def extract():
    # Logic for data extraction
    pass

def transform():
    # Logic for data transformation
    pass

def load():
    # Logic for data loading
    pass




default_args = {
    'owner': 'airflow',
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
    'start_date': datetime(2025, 1, 1),
}

dag = DAG('etl_pipeline', default_args=default_args, schedule_interval='@daily')

start_task = DummyOperator(task_id='start', dag=dag)

extract_task = PythonOperator(task_id='extract', python_callable=extract, dag=dag)
transform_task = PythonOperator(task_id='transform', python_callable=transform, dag=dag)
load_task = PythonOperator(task_id='load', python_callable=load, dag=dag)

start_task >> extract_task >> transform_task >> load_task
