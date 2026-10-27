import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';

import { TaskManagerComponent } from '../../components/task-manager/task-manager.component';
import { TaskView } from '../../models/task.models';

@Component({
  selector: 'app-task-list',
  imports: [RouterLink, RouterLinkActive, TaskManagerComponent],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.css',
})
export class TaskListComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly view = this.route.snapshot.data['taskView'] as TaskView;
  protected readonly title = this.route.snapshot.data['taskTitle'] as string;
}
